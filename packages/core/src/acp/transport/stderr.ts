import os from 'node:os';
import type { ChildProcess } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

export const STDERR_TAIL_BYTES = 4096;
const tails = new WeakMap<
  ChildProcess,
  { raw: string; environment: Record<string, string | undefined> }
>();

export function sanitizeStderr(
  text: string,
  environment: Record<string, string | undefined> = process.env,
): string {
  let clean = text.replaceAll('\0', '');
  for (const [key, value] of Object.entries(environment)) {
    if (
      value &&
      value.length >= 4 &&
      /secret|token|password|api.?key|credential|authorization/i.test(key)
    )
      clean = clean.split(value).join('[redacted]');
  }
  for (const home of new Set([environment.HOME, environment.USERPROFILE, os.homedir()]))
    if (home && home.length > 1) clean = clean.split(home).join('~');
  return clean
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\bAuthorization:\s*Basic\s+\S+/gi, 'Authorization: Basic [redacted]')
    .replace(
      /\b(?:x-api-key|api[_-]?key|access[_-]?token|password|secret)\s*[:=]\s*\S+/gi,
      '[redacted credential]',
    )
    .replace(
      /\b(?:sk-[A-Za-z0-9][A-Za-z0-9-]{7,}|gh[pousr]_[A-Za-z0-9]+|xox[a-zA-Z]-[A-Za-z0-9-]+)\b/g,
      '[redacted]',
    )
    .replace(/https?:\/\/[^\s]*\/pair#[^\s]*/gi, '[pairing URL]')
    .replace(/(https?:\/\/[^\s?#]+)\?[^\s]*/gi, '$1?[redacted query]')
    .trim();
}

export function observeAcpStderr(
  child: ChildProcess,
  environment: Record<string, string | undefined> = process.env,
): void {
  const existing = tails.get(child);
  if (existing) {
    existing.environment = { ...existing.environment, ...environment };
    return;
  }
  const tail = { raw: '', environment };
  tails.set(child, tail);
  const decoder = new StringDecoder('utf8');
  const append = (text: string) => {
    const bytes = Buffer.from(tail.raw + text);
    let start = Math.max(0, bytes.length - STDERR_TAIL_BYTES);
    while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start++;
    tail.raw = bytes.subarray(start).toString();
  };
  child.stderr?.on('data', (data: Buffer) => append(decoder.write(data)));
  child.stderr?.on('end', () => append(decoder.end()));
}

export function stderrExcerpt(child: ChildProcess): string {
  const tail = tails.get(child);
  return tail ? sanitizeStderr(tail.raw, tail.environment) : '';
}

/** Preserve protocol error types/codes so diagnostics cannot change negotiation. */
export function withProcessDiagnostics(error: unknown, child: ChildProcess): Error {
  const result = error instanceof Error ? error : new Error(String(error));
  const tail = tails.get(child);
  result.message = sanitizeStderr(result.message, tail?.environment);
  const excerpt = stderrExcerpt(child);
  if (excerpt && !result.message.includes(excerpt)) result.message += `\nAgent stderr: ${excerpt}`;
  return result;
}
