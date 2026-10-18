import { describe, it, expect, vi, beforeEach } from 'vite-plus/test';
import Fastify from 'fastify';
import { registerGracefulShutdown } from './lifecycle.js';

describe('registerGracefulShutdown', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('orchestrates clean close and runs onClose hooks', async () => {
    const app = Fastify();
    let hookExecuted = false;

    app.addHook('onClose', () => {
      hookExecuted = true;
    });

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    const shutdown = registerGracefulShutdown(app, {
      timeoutMs: 2000,
      listenToSignals: false,
    });

    await shutdown('TEST');

    expect(hookExecuted).toBe(true);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('prevents multiple simultaneous shutdown invocations', async () => {
    const app = Fastify();
    let closeCallCount = 0;

    app.addHook('onClose', () => {
      closeCallCount++;
    });

    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    const shutdown = registerGracefulShutdown(app, {
      timeoutMs: 2000,
      listenToSignals: false,
    });

    // Invoke multiple concurrent shutdowns
    await Promise.all([shutdown('SIGTERM'), shutdown('SIGINT'), shutdown('IPC')]);

    expect(closeCallCount).toBe(1);
  });
});
