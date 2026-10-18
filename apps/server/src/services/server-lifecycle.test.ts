import { afterEach, expect, test, vi } from 'vite-plus/test';
import { ServerLifecycle } from './server-lifecycle.js';

function setup() {
  const deps = {
    sessions: { stopAll: vi.fn().mockResolvedValue(undefined) },
    providers: {
      dispose: vi.fn(),
      sync: vi.fn().mockResolvedValue(undefined),
      autoUpdateInstalledProviders: vi.fn().mockResolvedValue(undefined),
      probeAllInstalledProviders: vi.fn().mockResolvedValue(undefined),
    },
    terminals: { closeAll: vi.fn() },
    gateway: { stop: vi.fn().mockResolvedValue(undefined) },
    events: { publishState: vi.fn() },
    log: { error: vi.fn() },
  };
  return { deps, lifecycle: new ServerLifecycle(deps as never) };
}
afterEach(() => vi.useRealTimers());

test('shutdown is awaited, ordered, and shared by concurrent close callers', async () => {
  const { deps, lifecycle } = setup();
  let release!: () => void;
  deps.sessions.stopAll.mockReturnValue(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  const first = lifecycle.stop();
  expect(lifecycle.stop()).toBe(first);
  expect(deps.providers.dispose).not.toHaveBeenCalled();
  release();
  await first;
  expect(deps.sessions.stopAll).toHaveBeenCalledOnce();
  expect(deps.providers.dispose).toHaveBeenCalledOnce();
  expect(deps.terminals.closeAll).toHaveBeenCalledOnce();
  expect(deps.gateway.stop).toHaveBeenCalledOnce();
});

test('failed session cleanup still closes other owned resources', async () => {
  const { deps, lifecycle } = setup();
  const failure = new Error('Session cleanup failed');
  deps.sessions.stopAll.mockRejectedValue(failure);
  await expect(lifecycle.stop()).rejects.toMatchObject({ errors: [failure] });
  expect(deps.providers.dispose).toHaveBeenCalledOnce();
  expect(deps.terminals.closeAll).toHaveBeenCalledOnce();
  expect(deps.gateway.stop).toHaveBeenCalledOnce();
});

test('background updates have one timer and do not start follow-up work after shutdown', async () => {
  vi.useFakeTimers();
  const { deps, lifecycle } = setup();
  let release!: () => void;
  deps.providers.sync.mockReturnValue(
    new Promise<void>((_resolve, reject) => {
      release = () => reject(new Error('Provider registry is disposed'));
    }),
  );
  lifecycle.startUpdates();
  lifecycle.startUpdates();
  expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
  expect(deps.providers.sync).toHaveBeenCalledOnce();
  await lifecycle.stop();
  expect(vi.getTimerCount()).toBe(0);
  release();
  await vi.advanceTimersByTimeAsync(0);
  expect(deps.providers.autoUpdateInstalledProviders).not.toHaveBeenCalled();
  expect(deps.providers.probeAllInstalledProviders).not.toHaveBeenCalled();
  expect(deps.events.publishState).not.toHaveBeenCalled();
  expect(deps.log.error).not.toHaveBeenCalled();
});
