import type { ChildProcess } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { redactAgentErrorText as sanitizeStderr } from '../../agent/error-redaction.js';

export { sanitizeStderr };

export const STDERR_TAIL_BYTES = 4096;
const tails = new WeakMap<
  ChildProcess,
  { raw: string; environment: Record<string, string | undefined> }
>();

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
  // Diagnostics belong in logs, not in the protocol/user-facing error message.
  if (excerpt) Object.assign(result, { processDiagnostics: excerpt });
  return result;
}
