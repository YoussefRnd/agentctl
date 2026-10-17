import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { forkMock } = vi.hoisted(() => ({ forkMock: vi.fn() }));
vi.mock('electron', () => ({ utilityProcess: { fork: forkMock } }));

function fakeServerProcess() {
  return Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    postMessage: vi.fn(),
    kill: vi.fn(),
  });
}

describe('desktop embedded server shutdown', () => {
  beforeEach(() => {
    vi.resetModules();
    forkMock.mockReset();
  });

  it('forces a server that does not exit after the grace period', async () => {
    vi.useFakeTimers();
    try {
      const child = fakeServerProcess();
      forkMock.mockReturnValue(child);
      const { startServer, stopServer } = await import('./serverManager.js');

      const starting = startServer();
      child.emit('message', { type: 'ready', port: 12345, secret: 'test' });
      await starting;

      const stopping = stopServer();
      await vi.advanceTimersByTimeAsync(4_500);
      await stopping;
      expect(child.kill).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits for the server to exit after requesting graceful shutdown', async () => {
    const child = fakeServerProcess();
    forkMock.mockReturnValue(child);
    const { startServer, stopServer } = await import('./serverManager.js');

    const starting = startServer();
    child.emit('message', { type: 'ready', port: 12345, secret: 'test' });
    await expect(starting).resolves.toBe(12345);

    const stopping = stopServer();
    expect(child.postMessage).toHaveBeenCalledWith({ type: 'shutdown' });
    expect(child.kill).not.toHaveBeenCalled();

    child.emit('exit', 0);
    await stopping;
    expect(child.kill).not.toHaveBeenCalled();
  });
  it('coalesces starts, validates readiness, clears credentials on exit and permits restart', async () => {
    const child = fakeServerProcess();
    forkMock.mockReturnValue(child);
    const manager = await import('./serverManager.js');
    const starting = manager.startServer();
    expect(manager.startServer()).toBe(starting);
    for (const message of [
      { type: 'ready', port: -1, secret: 'secret' },
      { type: 'ready', port: 1234 },
    ])
      child.emit('message', message);
    expect(manager.getServerPort()).toBe(0);
    child.emit('message', { type: 'ready', port: 1234, secret: 'secret' });
    await starting;
    await expect(manager.startServer()).resolves.toBe(1234);
    expect(forkMock).toHaveBeenCalledOnce();
    child.emit('exit', 0);
    expect(manager.getServerPort()).toBe(0);
    expect(manager.getServerSecret()).toBe('');
    const restart = manager.startServer();
    child.emit('message', { type: 'ready', port: 4321, secret: 'replacement' });
    await expect(restart).resolves.toBe(4321);
    child.emit('exit', 0);
  });
  it('rejects even a clean exit before readiness', async () => {
    const child = fakeServerProcess();
    forkMock.mockReturnValue(child);
    const manager = await import('./serverManager.js');
    const starting = manager.startServer();
    child.emit('exit', 0);
    await expect(starting).rejects.toThrow('before ready');
  });
  it('cancels pending startup and ignores late ready messages', async () => {
    const child = fakeServerProcess();
    forkMock.mockReturnValue(child);
    const manager = await import('./serverManager.js');
    const starting = manager.startServer();
    const rejected = expect(starting).rejects.toThrow('cancelled');
    const stopping = manager.stopServer();
    child.emit('message', { type: 'ready', port: 1234, secret: 'late' });
    child.emit('exit', 0);
    await Promise.all([rejected, stopping]);
    expect(manager.getServerPort()).toBe(0);
  });
  it('kills timed out startup instead of leaving an orphan', async () => {
    vi.useFakeTimers();
    try {
      const child = fakeServerProcess();
      forkMock.mockReturnValue(child);
      const manager = await import('./serverManager.js');
      const rejected = expect(manager.startServer()).rejects.toThrow('15 seconds');
      await vi.advanceTimersByTimeAsync(15_000);
      await rejected;
      expect(child.kill).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
