import { spawn, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import { Readable, Writable } from 'node:stream';
import type { Logger } from '../../logger.js';
import { noopLogger } from '../../logger.js';
import type { AgentDiagnosticsRecorder, AgentDiagnosticAdapter } from '../../agent/diagnostics.js';
import type { AgentStreamTransport } from '../types.js';

export class ProcessStreamTransport implements AgentStreamTransport {
  public readonly stdin: WritableStream<Uint8Array>;
  public readonly stdout: ReadableStream<Uint8Array>;
  public readonly closed: Promise<void>;
  private _isClosed = false;

  get isClosed(): boolean {
    return this._isClosed;
  }

  get isAlive(): boolean {
    return !this._isClosed && !this.child.killed && this.child.exitCode === null;
  }

  constructor(
    public readonly child: ChildProcess,
    private logger: Logger,
  ) {
    const stdin = child.stdin;
    const stdout = child.stdout;
    const stderr = child.stderr;

    if (!stdin || !stdout) {
      child.kill();
      throw new Error('Spawned process missing stdin/stdout');
    }

    if (stderr) {
      stderr.on('data', (data: Buffer) => {
        logger.warn(`Process stderr: ${data.toString()}`);
      });
    }

    this.stdin = Writable.toWeb(stdin) as WritableStream<Uint8Array>;
    this.stdout = Readable.toWeb(stdout) as ReadableStream<Uint8Array>;

    this.child.once('exit', () => {
      this._isClosed = true;
    });

    this.closed = new Promise<void>((resolve, reject) => {
      let resolved = false;

      const handleExit = (code: number | null, signal: NodeJS.Signals | null) => {
        if (resolved) return;
        resolved = true;
        this._isClosed = true;
        if (code === 0 || code === null) {
          resolve();
        } else {
          reject(
            new Error(
              `Process exited with code ${String(code)}${signal ? ` and signal ${signal}` : ''}`,
            ),
          );
        }
      };

      child.on('exit', handleExit);
      child.on('error', (err) => {
        if (resolved) return;
        resolved = true;
        this._isClosed = true;
        reject(err);
      });
    });
  }

  kill(signal: NodeJS.Signals | number = 'SIGTERM'): void {
    this._isClosed = true;
    terminateChildProcess(this.child, this.logger, 2000, signal);
  }
}

export function cleanEnv(env: Record<string, string> = {}): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }

  Object.assign(result, env);

  delete result.npm_config_engine_strict;
  delete result.npm_config_user_agent;
  delete result.npm_package_manager;
  return result;
}

export function terminateChildProcess(
  child: ChildProcess,
  logger: Logger = noopLogger,
  timeoutMs = 2000,
  signal: NodeJS.Signals | number = 'SIGTERM',
): void {
  if (!child.killed) {
    child.kill(signal);

    if (signal === 'SIGTERM') {
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          logger.warn(
            `Process did not exit on SIGTERM, sending SIGKILL to PID ${String(child.pid)}`,
          );
          child.kill('SIGKILL');
        }
      }, timeoutMs).unref();
    }
  }
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Timed out while ${label}`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

export interface SpawnManagedProcessOptions {
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
  spawnImpl?: typeof spawn;
  logger?: Logger;
  diagnostics?: AgentDiagnosticsRecorder;
  adapter?: AgentDiagnosticAdapter;
  providerId?: string;
  createTransport?: (child: ChildProcess, logger: Logger) => AgentStreamTransport;
}

export interface ManagedProcess {
  child: ChildProcess;
  transport: AgentStreamTransport;
  terminate: (signal?: NodeJS.Signals | number) => void;
}

export function spawnManagedProcess(options: SpawnManagedProcessOptions): ManagedProcess {
  const {
    command,
    args,
    env,
    cwd = os.tmpdir(),
    spawnImpl = spawn,
    logger = noopLogger,
    diagnostics,
    adapter,
    providerId,
    createTransport = (c, l) => new ProcessStreamTransport(c, l),
  } = options;

  if (diagnostics && adapter) {
    diagnostics.record({
      kind: 'connection_starting',
      adapter,
      providerId: providerId ?? 'unknown',
      path: 'spawn',
    });
  }

  const child = spawnImpl(command, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: cleanEnv(env),
    cwd,
  });

  if (diagnostics && adapter) {
    child.once('exit', () => {
      diagnostics.record({
        kind: 'connection_exited',
        adapter,
        providerId: providerId ?? 'unknown',
        path: 'spawn',
        reason: 'process_exit',
      });
    });
  }

  const transport = createTransport(child, logger);

  return {
    child,
    transport,
    terminate: (signal = 'SIGTERM') => {
      transport.kill(signal);
    },
  };
}
