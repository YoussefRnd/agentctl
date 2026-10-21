import { getEventListeners } from 'node:events';
import { AsyncLocalStorage } from 'node:async_hooks';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { expect, it, vi } from 'vite-plus/test';
import { SessionHistoryWorkQueue } from './session-history-work-queue.js';

it('keeps each request async context across shared slices and promise completion', async () => {
  const queue = new SessionHistoryWorkQueue();
  const context = new AsyncLocalStorage<string>();
  const observed: Record<string, (string | undefined)[]> = { first: [], second: [] };
  try {
    const results = await Promise.all(
      ['first', 'second'].map((name) =>
        context.run(name, async () => {
          const result = await queue.run(
            (function* () {
              for (let i = 0; i < 300; i++) {
                observed[name].push(context.getStore());
                yield;
              }
              return context.getStore();
            })(),
          );
          expect(context.getStore()).toBe(name);
          return result;
        }),
      ),
    );
    expect(results).toEqual(['first', 'second']);
    for (const name of ['first', 'second'])
      expect(new Set(observed[name])).toEqual(new Set([name]));
  } finally {
    context.disable();
  }
});

it('shares one time budget across jobs and resumes them fairly on later loop turns', async () => {
  const queue = new SessionHistoryWorkQueue();
  const steps: string[] = [];
  function* job(name: string) {
    for (let i = 0; i < 4; i++) {
      steps.push(name);
      yield;
    }
    return name;
  }
  let time = 0;
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => ++time);
  try {
    const first = queue.run(job('first'));
    const second = queue.run(job('second'));
    await nextTurn();
    expect(steps).toEqual(['first', 'second']);
    expect(await Promise.all([first, second])).toEqual(['first', 'second']);
    expect(steps).toEqual(Array.from({ length: 4 }, () => ['first', 'second']).flat());
  } finally {
    clock.mockRestore();
  }
});

it('removes canceled work, closes its iterator and releases abort listeners between slices', async () => {
  const queue = new SessionHistoryWorkQueue();
  const controller = new AbortController();
  let steps = 0;
  let closed = false;
  function* job() {
    try {
      for (let i = 0; i < 1000; i++) {
        steps++;
        yield;
      }
    } finally {
      closed = true;
    }
  }
  const result = queue.run(job(), controller.signal);
  const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
  await nextTurn();
  expect(steps).toBeGreaterThan(0);
  expect(steps).toBeLessThan(1000);
  controller.abort();
  const stoppedAt = steps;
  await rejected;
  await nextTurn();
  expect(steps).toBe(stoppedAt);
  expect(closed).toBe(true);
  expect(getEventListeners(controller.signal, 'abort')).toEqual([]);
});

it('isolates a failed job and never starts work for an already aborted request', async () => {
  const queue = new SessionHistoryWorkQueue();
  const failed = new AbortController();
  let entered = false;
  function* cancelled() {
    entered = true;
    yield;
  }
  failed.abort();
  await expect(queue.run(cancelled(), failed.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(entered).toBe(false);
  function* bad() {
    yield;
    throw new Error('invalid history');
  }
  function* good() {
    yield;
    return 'healthy';
  }
  const signal = new AbortController().signal;
  const rejected = expect(queue.run(bad(), signal)).rejects.toThrow('invalid history');
  expect(await queue.run(good(), signal)).toBe('healthy');
  await rejected;
  expect(getEventListeners(signal, 'abort')).toEqual([]);
});
