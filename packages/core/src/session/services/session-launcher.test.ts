import { expect, test, vi } from 'vitest';
import { SessionLauncher, type SessionLauncherDependencies } from './session-launcher.js';
import type { SessionRuntime } from '../runtime/session-runtime.js';
import { noopLogger } from '../../logger.js';

function fixture() {
  let resolve!: (session: SessionRuntime) => void;
  let reject!: (error: Error) => void;
  const pending = new Promise<SessionRuntime>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const runtime = { isDead: false } as SessionRuntime;
  const deps = {
    db: {
      query: {
        nativeSessionImports: { findFirst: async () => undefined },
        sessions: { findFirst: async () => ({ status: 'idle' }) },
      },
    },
    sessionWorkspace: { ensureAvailable: async () => true },
    runtimeRegistry: { getSession: vi.fn(() => undefined as SessionRuntime | undefined) },
    restartSession: vi.fn(() => pending),
    logger: noopLogger,
  } as unknown as SessionLauncherDependencies;
  return { launcher: new SessionLauncher(deps), deps, runtime, resolve, reject };
}

test('shares provider startup between input dispatch and concurrent stream connections', async () => {
  const context = fixture();
  const requests = [
    context.launcher.getOrResuscitate('s'),
    context.launcher.getOrResuscitate('s'),
    context.launcher.getOrResuscitate('s'),
  ];
  await vi.waitFor(() => expect(context.deps.restartSession).toHaveBeenCalledOnce());
  context.resolve(context.runtime);
  expect(await Promise.all(requests)).toEqual([context.runtime, context.runtime, context.runtime]);
});

test('allows another startup after the shared startup failed', async () => {
  const context = fixture();
  const first = context.launcher.getOrResuscitate('s');
  const failure = expect(first).rejects.toThrow('startup failed');
  await vi.waitFor(() => expect(context.deps.restartSession).toHaveBeenCalledOnce());
  context.reject(new Error('startup failed'));
  await failure;
  vi.mocked(context.deps.restartSession).mockResolvedValueOnce(context.runtime);
  expect(await context.launcher.getOrResuscitate('s')).toBe(context.runtime);
  expect(context.deps.restartSession).toHaveBeenCalledTimes(2);
});
