import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import type { AgentDriver, AgentSession, AgentSessionOptions } from './types.js';

const commitSchema = z.object({
  subject: z
    .string()
    .trim()
    .min(1)
    .max(72)
    .refine((s) => !/[\r\n]/.test(s) && !s.includes(String.fromCharCode(0))),
  body: z
    .string()
    .trim()
    .max(12_000)
    .refine((s) => !s.includes(String.fromCharCode(0))),
});
const prSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine((s) => !/[\r\n]/.test(s) && !s.includes(String.fromCharCode(0))),
  body: z
    .string()
    .trim()
    .min(1)
    .max(24_000)
    .refine((s) => !s.includes(String.fromCharCode(0))),
});

export function parseGitTextOutput(output: string, kind: 'commit' | 'merge' | 'pr') {
  const raw = JSON.parse(
    output
      .trim()
      .replace(/^```(?:json)?\s*\n?/, '')
      .replace(/\n?```$/, ''),
  );
  if (kind === 'pr') return prSchema.parse(raw);
  const { subject, body } = commitSchema.parse(raw);
  return { title: subject, body };
}

/** Isolated, short-lived ACP session; never resumes or writes to the user's conversation. */
export async function generateGitText(
  driver: AgentDriver,
  launch: { command: string; args: string[]; env: Record<string, string> },
  options: Omit<AgentSessionOptions, 'cwd' | 'intent'>,
  prompt: string,
  kind: 'commit' | 'merge' | 'pr',
  timeoutMs = 120_000,
) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'agentctl-git-text-'));
  let session: AgentSession | undefined;
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let output = '';
  let overflow = false;
  const operation = (async () => {
    const started = await driver.startSession(
      launch.command,
      launch.args,
      {
        ...options,
        cwd,
        env: launch.env,
        intent: { kind: 'new' },
        mcpServers: [],
        additionalDirectories: [],
        mcpGateway: undefined,
      },
      {
        onRequestPermission: async () => ({ allowed: false }),
        onRequestElicitation: async () => ({ action: 'cancel' }),
        onUpdate(event) {
          if (event.type !== 'text' || overflow) return;
          output = event.operation === 'replace' ? event.text : output + event.text;
          if (output.length > 32_000) {
            overflow = true;
            output = '';
          }
        },
      },
    );
    session = started;
    if (expired) {
      await started.close();
      throw new Error('Draft generation timed out.');
    }
    const result = await started.prompt(prompt);
    if (overflow) throw new Error('Generated draft exceeded the output limit.');
    if (result.error) throw new Error(result.error.message);
    if (result.stopReason !== 'end_turn')
      throw new Error(
        `Draft generation stopped (${result.stopReason}). Try again or write it manually.`,
      );
    try {
      return parseGitTextOutput(output, kind);
    } catch {
      throw new Error('The provider returned an invalid draft. Try again or write it manually.');
    }
  })();
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          expired = true;
          reject(new Error('Draft generation timed out. Try again or write it manually.'));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    expired = true;
    if (session) await session.close().catch(() => undefined);
    await rm(cwd, { recursive: true, force: true });
  }
}
