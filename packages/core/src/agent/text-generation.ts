import { z } from 'zod';
import { parseAgentJson, runIsolatedAgentText } from './isolated-text.js';
import type { AgentDriver, AgentSessionOptions } from './types.js';

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
  const raw = parseAgentJson(output);
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
  const result = await runIsolatedAgentText({
    driver,
    launch,
    options,
    prompt,
    outputLimit: 32_000,
    timeoutMs,
  });
  switch (result.status) {
    case 'cancelled':
    case 'timed_out':
      throw new Error('Draft generation timed out. Try again or write it manually.');
    case 'output_limit':
      throw new Error('Generated draft exceeded the output limit.');
    case 'stopped':
      throw new Error(
        `Draft generation stopped (${result.reason}). Try again or write it manually.`,
      );
    case 'completed':
      try {
        return parseGitTextOutput(result.output, kind);
      } catch {
        throw new Error('The provider returned an invalid draft. Try again or write it manually.');
      }
  }
}
