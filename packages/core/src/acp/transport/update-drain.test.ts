import { expect, test } from 'vitest';
import { AcpUpdateQueue, drainableCallbacks } from './update-drain.js';

test('drain waits for ordered persistence rather than just notification receipt', async () => {
  const seen: string[] = [];
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const updates = drainableCallbacks({
    onRequestPermission: async () => ({ allowed: false }),
    onUpdate: async (event) => {
      if (event.type !== 'text') return;
      if (event.text === 'first') await held;
      seen.push(event.text);
    },
  });
  const first = updates.callbacks.onUpdate({ type: 'text', text: 'first' });
  const second = updates.callbacks.onUpdate({ type: 'text', text: 'second' });
  let drained = false;
  const drain = updates.drain().then(() => {
    drained = true;
  });
  await Promise.resolve();
  expect(seen).toEqual([]);
  expect(drained).toBe(false);
  release();
  await Promise.all([first, second, drain]);
  expect(seen).toEqual(['first', 'second']);
  expect(drained).toBe(true);
});

test('drain includes updates enqueued while earlier writes are pending', async () => {
  const queue = new AcpUpdateQueue();
  let releaseFirst!: () => void;
  let releaseSecond!: () => void;
  const first = queue.enqueue(
    () =>
      new Promise<void>((resolve) => {
        releaseFirst = resolve;
      }),
  );
  await Promise.resolve();
  await Promise.resolve();
  let drained = false;
  const draining = queue.drain().then(() => {
    drained = true;
  });
  const second = queue.enqueue(
    () =>
      new Promise<void>((resolve) => {
        releaseSecond = resolve;
      }),
  );
  releaseFirst();
  await first;
  await Promise.resolve();
  expect(drained).toBe(false);
  releaseSecond();
  await Promise.all([second, draining]);
  expect(drained).toBe(true);
});

test('update backlog is bounded and its overflow cannot be hidden by subsequent writes', async () => {
  const queue = new AcpUpdateQueue(1);
  let release!: () => void;
  const first = queue.enqueue(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  await Promise.resolve();
  await Promise.resolve();
  const skipped = () => {
    throw new Error('overflow work must not run');
  };
  await expect(queue.enqueue(skipped)).rejects.toThrow('Too many pending');
  release();
  await first;
  await expect(queue.drain()).rejects.toThrow('Too many pending');
  await queue.enqueue(() => undefined);
  await expect(queue.drain()).resolves.toBeUndefined();
});

test('a later successful update cannot hide an earlier persistence failure', async () => {
  const updates = drainableCallbacks({
    onRequestPermission: async () => ({ allowed: false }),
    onUpdate: async (event) => {
      if (event.type === 'text' && event.text === 'fail') throw new Error('database unavailable');
    },
  });
  await expect(updates.callbacks.onUpdate({ type: 'text', text: 'fail' })).rejects.toThrow(
    'database unavailable',
  );
  await updates.callbacks.onUpdate({ type: 'text', text: 'success' });
  await expect(updates.drain()).rejects.toThrow('database unavailable');
  await updates.callbacks.onUpdate({ type: 'text', text: 'new turn' });
  await expect(updates.drain()).resolves.toBeUndefined();
});

test('retained byte limits include queued multibyte payloads and release bytes after work settles', async () => {
  const queue = new AcpUpdateQueue(10, 12);
  const held = Promise.withResolvers<void>();
  const first = queue.enqueue(() => held.promise, '🙂'); // six UTF-8 bytes including JSON quotes
  expect(queue.snapshot()).toMatchObject({ pending: 1, bytes: 6 });
  await expect(queue.enqueue(() => undefined, '🙂🙂')).rejects.toThrow('byte budget');
  held.resolve();
  await first;
  expect(queue.snapshot()).toMatchObject({ pending: 0, bytes: 0, peakBytes: 6 });
  await expect(queue.drain()).rejects.toThrow('byte budget');
});
