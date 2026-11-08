import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AgentDriver, AgentSession, AgentSessionOptions, AgentStopReason } from './types.js';

type Interruption = 'cancelled' | 'timed_out';
type TextResult =
  | { status: Interruption | 'output_limit' }
  | { status: 'stopped'; reason: AgentStopReason }
  | { status: 'completed'; output: string };

export async function runIsolatedAgentText({
  driver,
  launch,
  options,
  prompt,
  outputLimit,
  timeoutMs,
  signal,
}: {
  driver: AgentDriver;
  launch: { command: string; args: string[]; env: Record<string, string> };
  options: Omit<AgentSessionOptions, 'cwd' | 'intent'>;
  prompt: string;
  outputLimit: number;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<TextResult> {
  if (signal?.aborted) return { status: 'cancelled' };
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'agentctl-isolated-text-'));
  const removeDirectory = () => rm(cwd, { recursive: true, force: true });
  let session: AgentSession | undefined;
  let interruption: Interruption | undefined;
  const { promise: interrupted, resolve } = Promise.withResolvers<TextResult>();
  const interrupt = (status: Interruption) => {
    interruption ??= status;
    resolve({ status: interruption });
  };
  const abort = () => interrupt('cancelled');
  const timer = setTimeout(() => interrupt('timed_out'), timeoutMs);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();

  const run = async (): Promise<TextResult> => {
    let output = '';
    let overflow = false;
    try {
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
            if (event.type !== 'text' || overflow || interruption) return;
            output = event.operation === 'replace' ? event.text : output + event.text;
            if (output.length > outputLimit) {
              overflow = true;
              output = '';
            }
          },
        },
      );
      if (interruption) {
        await started.close().catch(() => undefined);
        return { status: interruption };
      }
      session = started;
      const result = await started.prompt(prompt);
      if (overflow) return { status: 'output_limit' };
      if (result.error) throw new Error(result.error.message);
      return result.stopReason === 'end_turn'
        ? { status: 'completed', output }
        : { status: 'stopped', reason: result.stopReason };
    } finally {
      // A provider can finish creating files after its caller's deadline and cleanup.
      if (interruption && !session) await removeDirectory();
    }
  };

  try {
    return await (interruption ? interrupted : Promise.race([run(), interrupted]));
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    if (session) await session.close().catch(() => undefined);
    await removeDirectory();
  }
}

export function parseAgentJson(output: string): unknown {
  return JSON.parse(
    output
      .trim()
      .replace(/^```(?:json)?\s*\n?/, '')
      .replace(/\n?```$/, ''),
  );
}
