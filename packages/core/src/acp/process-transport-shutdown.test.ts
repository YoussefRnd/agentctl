import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { ProcessStreamTransport } from './transport/process-transport.js';
import { noopLogger } from '../logger.js';

function createMockChildProcess(): {
  child: ChildProcess;
  emitter: EventEmitter;
  stdin: PassThrough;
  stdout: PassThrough;
} {
  const emitter = new EventEmitter();
  const stdin = new PassThrough();
  const stdout = new PassThrough();

  let isKilled = false;

  const child = Object.assign(emitter, {
    stdin,
    stdout,
    stderr: new PassThrough(),
    get killed() {
      return isKilled;
    },
    exitCode: null as number | null,
    pid: 12345,
    kill: (signal?: string | number) => {
      isKilled = true;
      emitter.emit('exit', 0, signal ?? 'SIGTERM');
      return true;
    },
  }) as unknown as ChildProcess;

  return { child, emitter, stdin, stdout };
}

describe('ProcessStreamTransport Health & Shutdown', () => {
  it('reports isAlive as true when process is active', () => {
    const { child } = createMockChildProcess();
    const transport = new ProcessStreamTransport(child, noopLogger);

    expect(transport.isAlive).toBe(true);
    expect(transport.isClosed).toBe(false);
  });

  it('reports isAlive as false and isClosed as true after kill()', () => {
    const { child } = createMockChildProcess();
    const transport = new ProcessStreamTransport(child, noopLogger);

    expect(transport.isAlive).toBe(true);

    transport.kill();

    expect(transport.isAlive).toBe(false);
    expect(transport.isClosed).toBe(true);
  });

  it('reports isAlive as false after process exits via exit event', async () => {
    const { child, emitter } = createMockChildProcess();
    const transport = new ProcessStreamTransport(child, noopLogger);

    expect(transport.isAlive).toBe(true);

    emitter.emit('exit', 0, null);

    expect(transport.isAlive).toBe(false);
    expect(transport.isClosed).toBe(true);
    await expect(transport.closed).resolves.toBeUndefined();
  });

  it('reports isAlive as false when child process is killed externally', () => {
    const { child } = createMockChildProcess();
    const transport = new ProcessStreamTransport(child, noopLogger);

    child.kill();

    expect(transport.isAlive).toBe(false);
  });
});
