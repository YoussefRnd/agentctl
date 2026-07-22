import { test, expect, describe } from 'vitest';
import { GitMutex } from './mutex.js';

describe('GitMutex Tests', () => {
  test('should execute tasks sequentially', async () => {
    const mutex = new GitMutex();
    const order: number[] = [];

    const p1 = mutex.run('key-1', async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      order.push(1);
    });

    const p2 = mutex.run('key-1', () => {
      order.push(2);
    });

    await Promise.all([p1, p2]);
    expect(order).toEqual([1, 2]);
  });

  test('should abort task when execution timeout is reached', async () => {
    const mutex = new GitMutex();

    await expect(
      mutex.run(
        'key-2',
        async (signal) => {
          await new Promise<void>((resolve, reject) => {
            if (signal.aborted) {
              reject(
                signal.reason instanceof Error
                  ? signal.reason
                  : new Error(String(signal.reason ?? 'Aborted')),
              );
            }
            signal.addEventListener('abort', () => {
              reject(
                signal.reason instanceof Error
                  ? signal.reason
                  : new Error(String(signal.reason ?? 'Aborted')),
              );
            });
          });
        },
        { timeoutMs: 10 },
      ),
    ).rejects.toThrow('timed out after 10ms');
  });

  test('should reject task if queue timeout is reached before execution starts', async () => {
    const mutex = new GitMutex();
    const order: string[] = [];

    // Long running task 1
    const p1 = mutex.run('key-3', async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      order.push('task-1');
    });

    // Task 2 enqueues with queueTimeoutMs of 20ms
    const p2 = mutex.run(
      'key-3',
      () => {
        order.push('task-2');
      },
      { queueTimeoutMs: 20 },
    );

    await Promise.allSettled([p1, p2]);

    await expect(p2).rejects.toThrow('Queue wait timed out after 20ms');
    expect(order).toEqual(['task-1']);
  });

  test('should propagate external AbortSignal cancellation', async () => {
    const mutex = new GitMutex();
    const controller = new AbortController();

    const p = mutex.run(
      'key-4',
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      },
      { signal: controller.signal },
    );

    // Abort early
    controller.abort(new Error('User cancelled'));

    await expect(p).rejects.toThrow('User cancelled');
  });

  test('should not execute subsequent tasks concurrently if a queued task is aborted', async () => {
    const mutex = new GitMutex();
    const order: number[] = [];

    // Task 1 starts running
    const p1 = mutex.run('key-concurrency', async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
      order.push(1);
    });

    // Task 2 is queued, but will be aborted while waiting
    const controller = new AbortController();
    const p2 = mutex.run(
      'key-concurrency',
      () => {
        order.push(2);
      },
      { signal: controller.signal },
    );

    // Task 3 is queued behind Task 2
    const p3 = mutex.run('key-concurrency', () => {
      order.push(3);
    });

    // Abort Task 2 immediately
    controller.abort(new Error('Task 2 aborted'));

    await Promise.allSettled([p1, p2, p3]);

    // Task 2 should reject, Task 1 and 3 should run in order: 1, then 3
    expect(order).toEqual([1, 3]);
  });
});
