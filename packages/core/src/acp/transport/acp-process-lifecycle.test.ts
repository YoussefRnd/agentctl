import { describe, it, expect, vi } from 'vite-plus/test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess, spawn } from 'node:child_process';
import {
  cleanEnv,
  terminateChildProcess,
  withTimeout,
  spawnManagedProcess,
  ProcessStreamTransport,
  bindSessionProcessEvents,
} from './acp-process-lifecycle.js';
import { noopLogger } from '../../logger.js';
import { AgentDiagnosticsRecorder } from '../../agent/diagnostics.js';

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
    signalCode: null as NodeJS.Signals | null,
    pid: 12345,
    kill: vi.fn((signal?: string | number) => {
      isKilled = true;
      emitter.emit('exit', 0, signal ?? 'SIGTERM');
      return true;
    }),
  }) as unknown as ChildProcess;

  return { child, emitter, stdin, stdout };
}

describe('cleanEnv', () => {
  it('strips npm-specific variables and merges extra environment', () => {
    process.env.npm_config_engine_strict = 'true';
    process.env.npm_config_user_agent = 'pnpm/10';
    process.env.npm_package_manager = 'pnpm';

    const cleaned = cleanEnv({ CUSTOM_VAR: 'hello' });

    expect(cleaned.CUSTOM_VAR).toBe('hello');
    expect(cleaned.npm_config_engine_strict).toBeUndefined();
    expect(cleaned.npm_config_user_agent).toBeUndefined();
    expect(cleaned.npm_package_manager).toBeUndefined();
  });
});

describe('session process event ownership', () => {
  it('releases one closed session’s listeners while other sessions remain subscribed', () => {
    const { child, emitter } = createMockChildProcess();
    const first = bindSessionProcessEvents(child);
    const second = bindSessionProcessEvents(child);
    const firstError = vi.fn();
    const firstClose = vi.fn();
    const secondError = vi.fn();
    const secondClose = vi.fn();
    first.onError(firstError);
    first.onClose(firstClose);
    second.onError(secondError);
    second.onClose(secondClose);
    first.dispose();
    expect(emitter.listenerCount('error')).toBe(1);
    expect(emitter.listenerCount('exit')).toBe(1);
    const error = new Error('process failed');
    emitter.emit('error', error);
    emitter.emit('exit', 1, null);
    expect(firstError).not.toHaveBeenCalled();
    expect(firstClose).not.toHaveBeenCalled();
    expect(secondError).toHaveBeenCalledWith(error);
    expect(secondClose).toHaveBeenCalledWith({
      code: 1,
      signal: null,
      message: 'Agent process exited with code 1',
    });
    second.dispose();
    expect(emitter.listenerCount('error')).toBe(0);
    expect(emitter.listenerCount('exit')).toBe(0);
  });
});

describe('terminateChildProcess', () => {
  it('does not send signal if process is already killed', () => {
    const { child } = createMockChildProcess();
    Object.defineProperty(child, 'killed', { value: true });

    terminateChildProcess(child, noopLogger);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('sends default SIGTERM to running process', () => {
    const { child } = createMockChildProcess();

    terminateChildProcess(child, noopLogger);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('escalates to SIGKILL if process fails to exit after timeout', async () => {
    vi.useFakeTimers();
    try {
      const emitter = new EventEmitter();
      const child = Object.assign(emitter, {
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        killed: false,
        exitCode: null,
        signalCode: null,
        pid: 99999,
        kill: vi.fn(),
      }) as unknown as ChildProcess;

      terminateChildProcess(child, noopLogger, 500);
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');

      vi.advanceTimersByTime(500);
      expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('withTimeout', () => {
  it('resolves with the promise value if it finishes before timeout', async () => {
    const result = await withTimeout(Promise.resolve(42), 1000, 'test operation');
    expect(result).toBe(42);
  });

  it('rejects with timeout error if promise takes too long', async () => {
    const slowPromise = new Promise((resolve) => setTimeout(resolve, 2000));
    await expect(withTimeout(slowPromise, 50, 'slow operation')).rejects.toThrow(
      'Timed out while slow operation',
    );
  });
});

describe('spawnManagedProcess', () => {
  it('spawns child process with sanitized environment and records diagnostics', async () => {
    const { child } = createMockChildProcess();
    const fakeSpawn = vi.fn(() => child) as unknown as typeof spawn;
    const diagnostics = new AgentDiagnosticsRecorder();

    const managed = spawnManagedProcess({
      command: 'echo',
      args: ['hello'],
      env: { FOO: 'bar' },
      cwd: '/tmp',
      spawnImpl: fakeSpawn,
      logger: noopLogger,
      diagnostics,
      adapter: 'acp-v1',
      providerId: 'provider-1',
    });

    expect(fakeSpawn).toHaveBeenCalledWith('echo', ['hello'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: expect.objectContaining({ FOO: 'bar' }),
      cwd: '/tmp',
      detached: process.platform !== 'win32',
      windowsHide: true,
    });

    expect(diagnostics.snapshot().events).toContainEqual(
      expect.objectContaining({
        kind: 'connection_starting',
        adapter: 'acp-v1',
        providerId: 'provider-1',
        path: 'spawn',
      }),
    );

    // Simulate exit
    (child as unknown as EventEmitter).emit('exit', 0, null);
    await expect(managed.transport.closed).resolves.toBeUndefined();

    expect(diagnostics.snapshot().events).toContainEqual(
      expect.objectContaining({
        kind: 'connection_exited',
        adapter: 'acp-v1',
        providerId: 'provider-1',
        path: 'spawn',
        reason: 'process_exit',
      }),
    );

    expect(managed.transport).toBeInstanceOf(ProcessStreamTransport);
  });
});
