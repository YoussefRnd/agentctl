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
});
