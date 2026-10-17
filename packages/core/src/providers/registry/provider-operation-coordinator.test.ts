import { describe, test, expect } from 'vitest';
import { ProviderOperationCoordinator } from './provider-operation-coordinator.js';

describe('ProviderOperationCoordinator', () => {
  test('allows parallel mutations but serializes sync operations', async () => {
    const coordinator = new ProviderOperationCoordinator();
    const order: string[] = [];

    const mutation1 = coordinator.runMutation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push('mutation1');
    });

    const mutation2 = coordinator.runMutation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push('mutation2');
    });

    const sync = coordinator.runSync(async () => {
      order.push('sync');
    });

    await Promise.all([mutation1, mutation2, sync]);

    expect(order.indexOf('sync')).toBeGreaterThan(order.indexOf('mutation1'));
    expect(order.indexOf('sync')).toBeGreaterThan(order.indexOf('mutation2'));
  });

  test('deduplicates identical in-flight provider operations', async () => {
    const coordinator = new ProviderOperationCoordinator();
    let executions = 0;

    const op = () =>
      coordinator.runProviderOperation('prov-1', 'install', async () => {
        executions += 1;
        await new Promise((resolve) => setTimeout(resolve, 30));
        return 42;
      });

    const [res1, res2] = await Promise.all([op(), op()]);

    expect(executions).toBe(1);
    expect(res1).toBe(42);
    expect(res2).toBe(42);
  });
});

test('shutdown rejects queued work and waits for the operation holding the lane', async () => {
  const coordinator = new ProviderOperationCoordinator();
  let finish!: () => void;
  const running = coordinator.runProviderOperation(
    'provider',
    'install',
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await Promise.resolve();
  await Promise.resolve();
  const queuedWork = () => {
    throw new Error('must not execute');
  };
  const queued = coordinator.runProviderOperation('provider', 'configure', queuedWork);
  const rejected = expect(queued).rejects.toThrow('disposed');
  coordinator.stop();
  let idle = false;
  const draining = coordinator.idle().then(() => {
    idle = true;
  });
  await Promise.resolve();
  expect(idle).toBe(false);
  finish();
  await Promise.all([running, rejected, draining]);
  await expect(coordinator.runSync(async () => undefined)).rejects.toThrow('disposed');
});

test('releasing a mutation lease twice cannot let sync overlap another mutation', async () => {
  const coordinator = new ProviderOperationCoordinator();
  const first = await coordinator.acquireMutation();
  const second = await coordinator.acquireMutation();
  let syncing = false;
  const sync = coordinator.runSync(async () => {
    syncing = true;
  });
  first();
  first();
  await Promise.resolve();
  expect(syncing).toBe(false);
  second();
  await sync;
});

test('shutdown drains background orchestration without blocking its nested mutations', async () => {
  const coordinator = new ProviderOperationCoordinator();
  let finish!: () => void;
  const release = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let nestedStarted!: () => void;
  const nested = new Promise<void>((resolve) => {
    nestedStarted = resolve;
  });
  const background = coordinator.runBackground(async () => {
    await coordinator.runProviderOperation('provider', 'probe', async () => {
      nestedStarted();
    });
    await release;
  });
  await nested;
  coordinator.stop();
  const rejected = expect(coordinator.runBackground(async () => undefined)).rejects.toThrow(
    'disposed',
  );
  let finished = false;
  const idle = coordinator.idle().then(() => {
    finished = true;
  });
  await Promise.resolve();
  expect(finished).toBe(false);
  finish();
  await Promise.all([background, rejected, idle]);
});
