import { describe, expect, it, vi } from 'vitest';
import { createDesktopRuntime } from './desktopRuntime';

function setup(startServer = vi.fn(async () => 1234)) {
  const dispose = vi.fn();
  const dependencies = {
    startServer,
    stopServer: vi.fn(async () => {}),
    openWindow: vi.fn(),
    setupResources: vi.fn(() => dispose),
  };
  return { ...dependencies, dispose, runtime: createDesktopRuntime(dependencies) };
}
describe('desktop resource ownership', () => {
  it('starts once and disposes once before awaiting server shutdown', async () => {
    const state = setup();
    expect(state.runtime.start()).toBe(state.runtime.start());
    await state.runtime.start();
    expect(state.openWindow).toHaveBeenCalledOnce();
    expect(state.runtime.stop()).toBe(state.runtime.stop());
    await state.runtime.stop();
    expect(state.dispose).toHaveBeenCalledOnce();
    expect(state.stopServer).toHaveBeenCalledOnce();
    expect(state.dispose.mock.invocationCallOrder[0]).toBeLessThan(
      state.stopServer.mock.invocationCallOrder[0]!,
    );
  });
  it('never opens native resources after shutdown races pending startup', async () => {
    let ready!: (port: number) => void;
    const state = setup(
      vi.fn(
        () =>
          new Promise<number>((resolve) => {
            ready = resolve;
          }),
      ),
    );
    const starting = state.runtime.start();
    const stopping = state.runtime.stop();
    ready(1234);
    await Promise.all([starting, stopping]);
    expect(state.openWindow).not.toHaveBeenCalled();
    expect(state.setupResources).not.toHaveBeenCalled();
  });
  it('propagates startup and shutdown errors', async () => {
    const state = setup(
      vi.fn(async () => {
        throw new Error('cannot bind');
      }),
    );
    await expect(state.runtime.start()).rejects.toThrow('cannot bind');
    state.stopServer.mockRejectedValueOnce(new Error('cannot stop'));
    await expect(state.runtime.stop()).rejects.toThrow('cannot stop');
  });
  it('treats cancellation during shutdown as a completed startup lifetime', async () => {
    let reject!: (error: Error) => void;
    const state = setup(
      vi.fn(
        () =>
          new Promise<number>((_resolve, fail) => {
            reject = fail;
          }),
      ),
    );
    state.stopServer.mockImplementationOnce(async () => {
      reject(new Error('cancelled'));
    });
    const starting = state.runtime.start();
    await state.runtime.stop();
    await expect(starting).resolves.toBeUndefined();
    expect(state.openWindow).not.toHaveBeenCalled();
  });
  it('never starts a server after the runtime has stopped', async () => {
    const state = setup();
    await state.runtime.stop();
    await expect(state.runtime.start()).rejects.toThrow('stopped');
    expect(state.startServer).not.toHaveBeenCalled();
  });
});
