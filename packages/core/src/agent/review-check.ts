import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { redactDiagnosticText } from './operation-diagnostics.js';

export function scrubReviewCheckText(
  value: string,
  env: Record<string, string | undefined> = process.env,
) {
  // eslint-disable-next-line no-control-regex -- Strip terminal ANSI CSI escape sequences.
  return redactDiagnosticText(value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, ''), env);
}
/** Drop partial leading lines after truncation so fragmented credentials cannot leak. */
class OutputTail {
  private decoder = new StringDecoder('utf8');
  private raw = '';
  private dropping = false;
  truncated = false;
  add(chunk: Buffer) {
    let text = this.decoder.write(chunk);
    if (this.dropping) {
      const newline = text.indexOf('\n');
      if (newline < 0) return;
      text = text.slice(newline + 1);
      this.dropping = false;
    }
    this.raw += text;
    if (this.raw.length > 48_000) {
      this.truncated = true;
      const tail = this.raw.slice(-48_000);
      const newline = tail.indexOf('\n');
      this.raw = newline < 0 ? '' : tail.slice(newline + 1);
      this.dropping = newline < 0;
    }
  }
  text(env: Record<string, string | undefined>, completeLinesOnly = false) {
    const text = completeLinesOnly ? this.raw.slice(0, this.raw.lastIndexOf('\n') + 1) : this.raw;
    return scrubReviewCheckText(text, env);
  }
}
export interface ReviewCheckOutput {
  stdout: string;
  stderr: string;
  outputTruncated: boolean;
}
export interface ReviewCheckExecution extends ReviewCheckOutput {
  status: 'passed' | 'failed' | 'error' | 'cancelled' | 'timed_out';
  exitCode: number | null;
  signal: string | null;
  error: string | null;
}
/** User-selected local shell command. Has no ACP/provider dependency and never runs automatically. */
export async function executeReviewCheck(
  command: string,
  cwd: string,
  timeoutMs: number,
  signal: AbortSignal,
  onOutput?: (output: ReviewCheckOutput) => void,
): Promise<ReviewCheckExecution> {
  if (signal.aborted)
    return {
      status: 'cancelled',
      exitCode: null,
      signal: null,
      error: 'Check cancelled.',
      stdout: '',
      stderr: '',
      outputTruncated: false,
    };
  const env = { ...process.env };
  // Provider profile environments are never passed to this runner; remove app transport secrets too.
  for (const key of Object.keys(env))
    if (/^AGENTCTL_.*(?:KEY|SALT|TOKEN|SECRET|CAPABILITY)/i.test(key)) delete env[key];
  const stdout = new OutputTail();
  const stderr = new OutputTail();
  const output = (completeLinesOnly = false) => ({
    stdout: stdout.text(process.env, completeLinesOnly),
    stderr: stderr.text(process.env, completeLinesOnly),
    outputTruncated: stdout.truncated || stderr.truncated,
  });
  return await new Promise<ReviewCheckExecution>((resolve) => {
    let settled = false;
    let timedOut = false;
    let cancelled = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let escapeTimer: ReturnType<typeof setTimeout> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const child = spawn(command, {
      cwd,
      env,
      shell: process.platform === 'win32' ? true : process.env.SHELL || '/bin/sh',
      detached: process.platform !== 'win32',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const kill = (force = false) => {
      if (!child.pid) return;
      if (process.platform === 'win32') {
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        });
        killer.on('error', () => {
          child.kill('SIGKILL');
        });
      } else {
        try {
          process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM');
        } catch {
          try {
            child.kill(force ? 'SIGKILL' : 'SIGTERM');
          } catch {
            /* Already exited. */
          }
        }
      }
    };
    const finish = (code: number | null, exitSignal: string | null, failure?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(killTimer);
      clearTimeout(escapeTimer);
      signal.removeEventListener('abort', abort);
      process.removeListener('exit', exitCleanup);
      // A shell may exit while children still hold pipes. Retire its owned process group too.
      kill(true);
      child.stdout.destroy();
      child.stderr.destroy();
      const status = cancelled
        ? 'cancelled'
        : timedOut
          ? 'timed_out'
          : failure || exitSignal
            ? 'error'
            : code === 0
              ? 'passed'
              : 'failed';
      resolve({
        ...output(),
        status,
        exitCode: code,
        signal: exitSignal,
        error: cancelled
          ? 'Check cancelled.'
          : timedOut
            ? 'Check timed out.'
            : failure
              ? scrubReviewCheckText(failure)
              : exitSignal
                ? `Check terminated by ${exitSignal}.`
                : null,
      });
    };
    const exitCleanup = () => kill(true);
    process.once('exit', exitCleanup);
    const stop = () => {
      kill();
      killTimer = setTimeout(() => kill(true), 1000);
      escapeTimer = setTimeout(() => finish(child.exitCode, child.signalCode), 2500);
    };
    const abort = () => {
      cancelled = true;
      stop();
    };
    child.stdout.on('data', (chunk: Buffer) => {
      stdout.add(chunk);
      onOutput?.(output(true));
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr.add(chunk);
      onOutput?.(output(true));
    });
    child.once('error', (error) => finish(null, null, error.message));
    child.once('close', (code, exitSignal) => finish(code, exitSignal));
    child.once('exit', () => {
      if (!settled && !escapeTimer)
        escapeTimer = setTimeout(() => {
          kill(true);
          finish(child.exitCode, child.signalCode);
        }, 1000);
    });
    signal.addEventListener('abort', abort, { once: true });
    timeout = setTimeout(() => {
      timedOut = true;
      stop();
    }, timeoutMs);
    if (signal.aborted) abort();
  });
}
