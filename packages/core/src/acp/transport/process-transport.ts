import { spawn, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import {
  ClientSideConnection,
  ndJsonStream,
  type RequestPermissionResponse,
} from '@agentclientprotocol/sdk';
import { type Logger } from '../../logger.js';
import type { AgentStreamTransport, ACPConnectionHandle } from '../types.js';

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
    if (!this.child.killed) {
      this.child.kill(signal);

      if (signal === 'SIGTERM') {
        setTimeout(() => {
          if (this.child.exitCode === null && this.child.signalCode === null) {
            this.logger.warn(
              `Process did not exit on SIGTERM, sending SIGKILL to PID ${String(this.child.pid)}`,
            );
            this.child.kill('SIGKILL');
          }
        }, 2000).unref();
      }
    }
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

export function createAgentConnection(
  command: string,
  args: string[],
  env: Record<string, string>,
  spawnImpl: typeof spawn = spawn,
): ACPConnectionHandle {
  const child = spawnImpl(command, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: cleanEnv(env),
    cwd: os.tmpdir(),
  });

  const stdin = child.stdin as typeof child.stdin | null;
  const stdout = child.stdout as typeof child.stdout | null;

  if (stdin === null || stdout === null) {
    child.kill();
    throw new Error('Spawned agent missing stdin/stdout');
  }

  const stream = ndJsonStream(
    Writable.toWeb(stdin) as WritableStream<Uint8Array>,
    Readable.toWeb(stdout) as ReadableStream<Uint8Array>,
  );

  const connection = new ClientSideConnection(
    () => ({
      sessionUpdate() {
        return Promise.resolve();
      },
      requestPermission(request) {
        void request;
        return Promise.resolve<RequestPermissionResponse>({
          outcome: { outcome: 'selected', optionId: 'allow-once' },
        });
      },
      async readTextFile(p: { path: string }) {
        const absPath = path.isAbsolute(p.path) ? p.path : path.resolve(os.tmpdir(), p.path);
        if (!fs.existsSync(absPath)) {
          throw new Error(`File not found: ${absPath}`);
        }
        const content = fs.readFileSync(absPath, 'utf8');
        return Promise.resolve({ content });
      },
      async writeTextFile(p: { path: string; content: string }) {
        const absPath = path.isAbsolute(p.path) ? p.path : path.resolve(os.tmpdir(), p.path);
        const dir = path.dirname(absPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(absPath, p.content, 'utf8');
        return Promise.resolve({});
      },
    }),
    stream,
  );

  return { child, connection };
}
