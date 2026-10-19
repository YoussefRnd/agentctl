import { fork } from 'node:child_process';
import type { ClientReply, ClientResult } from './client-protocol.js';

/** Bounded IPC lifecycle; a failed parent never leaves the load generator running. */
export class BenchmarkClient {
  private child = fork(new URL('./client.js', import.meta.url), [], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    execArgv: [],
  });
  private logs = '';
  private exited = new Promise<number | null>((resolve) =>
    this.child.once('close', (code) => resolve(code)),
  );

  constructor() {
    // Keep a listener even between IPC waits so spawn errors never become unhandled events.
    this.child.on('error', (error) => {
      this.logs += error.message;
    });
    for (const stream of [this.child.stdout, this.child.stderr])
      stream!.on('data', (data: Buffer) => {
        this.logs = (this.logs + data.toString()).slice(-32_000);
      });
  }

  private receive<T extends ClientReply['type']>(type: T) {
    return new Promise<Extract<ClientReply, { type: T }>>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        this.child.off('message', message);
        this.child.off('exit', failed);
        this.child.off('error', failed);
      };
      const failed = () => {
        cleanup();
        reject(new Error(`Benchmark client failed waiting for ${type}: ${this.logs}`));
      };
      const message = (value: unknown) => {
        if (!value || typeof value !== 'object' || !('type' in value) || value.type !== type) {
          failed();
          return;
        }
        cleanup();
        resolve(value as Extract<ClientReply, { type: T }>);
      };
      const timer = setTimeout(failed, 45_000);
      this.child.once('message', message);
      this.child.once('exit', failed);
      this.child.once('error', failed);
      if (this.child.exitCode !== null || this.child.signalCode !== null) failed();
    });
  }

  async setup(url: string, ids: string[]) {
    const ready = this.receive('ready');
    this.child.send({ type: 'setup', url, ids });
    await ready;
  }

  run(): Promise<ClientResult> {
    const done = this.receive('done');
    this.child.send({ type: 'start' });
    return done;
  }

  async close() {
    const timeout = setTimeout(() => this.child.kill('SIGKILL'), 5_000);
    try {
      if (this.child.connected) this.child.send({ type: 'close' }, () => {});
      else this.child.kill('SIGTERM');
      return await this.exited;
    } finally {
      clearTimeout(timeout);
    }
  }
}
