import { afterEach, expect, test } from 'vite-plus/test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setImmediate as yieldLoop } from 'node:timers/promises';
import { createBackendFixture, waitUntil } from './fixture.js';

const fixtures: Awaited<ReturnType<typeof createBackendFixture>>[] = [];
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close();
});
async function fixture(options: Parameters<typeof createBackendFixture>[0]) {
  const value = await createBackendFixture(options);
  fixtures.push(value);
  return value;
}

test('20 sessions overlap, keep FIFO per session, and deliver every accepted turn once', async () => {
  const context = await fixture({ sessions: 20 });
  await Promise.all(
    context.ids.map(async (id) => {
      await Promise.all(Array.from({ length: 3 }, (_, turn) => context.send(id, `turn ${turn}`)));
    }),
  );
  await waitUntil(
    () =>
      context.operations().length === 60 &&
      context.operations().every((row) => row.status === 'succeeded'),
    'all 60 completed turns',
  );
  expect(context.maxActive).toBeGreaterThan(1);
  expect(context.dispatches).toHaveLength(60);
  for (const id of context.ids) {
    const accepted = context
      .operations()
      .filter((row) => row.sessionId === id)
      .sort((a, b) => a.queuePosition - b.queuePosition);
    expect(
      context.dispatches.filter((row) => row.sessionId === id).map((row) => row.command),
    ).toEqual(accepted.map((row) => (JSON.parse(row.payload) as { text: string }).text));
  }
}, 30_000);

test('concurrent retries share one durable receipt and dispatch', async () => {
  const context = await fixture({ sessions: 1 });
  const command = randomUUID();
  const receipts = await Promise.all(
    Array.from({ length: 24 }, () => context.send(context.ids[0], 'same input', command)),
  );
  expect(receipts.every((receipt) => JSON.stringify(receipt) === JSON.stringify(receipts[0]))).toBe(
    true,
  );
  await waitUntil(() => context.operations().every((row) => row.status === 'succeeded'));
  expect(context.operations()).toHaveLength(1);
  expect(context.dispatches).toHaveLength(1);
});

test('one provider failure pauses its queue without blocking other sessions', async () => {
  const context = await fixture({
    sessions: 5,
    prompt: async (runtime, text) => {
      await yieldLoop();
      if (text === 'fail') throw new Error('Synthetic provider failure');
      await runtime.handleDomainEvent({ type: 'text', text: 'healthy' });
      return { stopReason: 'end_turn' };
    },
  });
  await context.pause();
  for (const id of context.ids) {
    await context.send(id, id === context.ids[0] ? 'fail' : 'healthy');
    await context.send(id, 'follow up');
  }
  await context.resume();
  await waitUntil(
    () => context.operations().filter((row) => row.status === 'succeeded').length === 8,
  );
  const failed = context.operations().filter((row) => row.sessionId === context.ids[0]);
  // The provider was dispatched, so an unclassified transport error is uncertain, never resent.
  expect(failed.map((row) => row.status)).toEqual(['unknown', 'pending']);
  expect(context.dispatches).toHaveLength(9);
}, 15_000);

test('active cancellation releases its lane and lets the next queued turn complete', async () => {
  let release = () => {};
  let entered = false;
  const context = await fixture({
    sessions: 2,
    cancel: async () => release(),
    prompt: async (_runtime, text) => {
      if (text === 'cancel active') {
        entered = true;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return { stopReason: 'cancelled' };
      }
      return { stopReason: 'end_turn' };
    },
  });
  try {
    await context.send(context.ids[0], 'cancel active');
    await waitUntil(() => entered);
    await context.send(context.ids[0], 'next queued turn');
    await context.send(context.ids[1], 'independent turn');
    await context.runtimes.get(context.ids[0])!.cancel();
    await waitUntil(() =>
      context.operations().every((row) => ['succeeded', 'cancelled'].includes(row.status)),
    );
    expect(context.operations().filter((row) => row.status === 'cancelled')).toHaveLength(1);
    expect(context.dispatches).toHaveLength(3);
  } finally {
    release();
  }
});

test('a paused SSE reader is disconnected under pressure while a healthy reader keeps receiving', async () => {
  const context = await fixture({ sessions: 1 });
  const id = context.ids[0];
  const slow = await context.stream(id);
  const healthy = await context.stream(id);
  slow.response.pause();
  const frames = 512;
  for (let index = 0; index < frames; index++) {
    context.app.eventBus.publish({
      id: index + 1,
      sessionId: id,
      type: 'text',
      data: { role: 'provider', content: 'x'.repeat(32_768) },
      createdAt: new Date(),
    });
    await yieldLoop();
  }
  await waitUntil(() => healthy.events.length === frames, 'healthy consumer receives the burst');
  slow.response.resume();
  await waitUntil(() => slow.response.readableEnded, 'slow response ends after draining');
  expect(slow.events.length).toBeLessThan(frames);
  await waitUntil(() => context.app.eventBus.listenerCount(id) === 1, 'slow subscriber cleanup');
  healthy.close();
  await waitUntil(() => context.app.eventBus.listenerCount(id) === 0);
}, 30_000);

test('a new OS process recovers accepted work and never replays uncertain dispatched input', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentctl-concurrency-recovery-'));
  try {
    for (const stage of ['accept', 'recover'])
      await promisify(execFile)(
        process.execPath,
        ['dist/tests/performance/recovery.js', stage, join(directory, 'queue.db')],
        {
          cwd: resolve(import.meta.dirname, '../..'),
          timeout: 30_000,
          env: {
            ...process.env,
            NODE_ENV: 'test',
            LOG_LEVEL: 'silent',
            AGENTCTL_TELEMETRY: '0',
            AGENTCTL_HOME: join(directory, 'home'),
          },
        },
      );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 65_000);

test('queued cancellation never reaches the provider while another session progresses', async () => {
  const context = await fixture({ sessions: 2 });
  await context.pause();
  const command = randomUUID();
  await context.send(context.ids[0], 'cancelled input', command);
  await context.send(context.ids[1], 'healthy input');
  await context.worker.changeQueuedMessage(context.ids[0], command, 'cancel');
  await context.resume();
  await waitUntil(() => context.operations().some((row) => row.status === 'succeeded'));
  expect(
    context
      .operations()
      .map((row) => row.status)
      .sort(),
  ).toEqual(['cancelled', 'succeeded']);
  expect(context.dispatches.map((row) => row.command)).toEqual(['healthy input']);
});

test('SSE fan-out stays ordered and disconnect/reconnect releases listeners and replays the gap', async () => {
  const context = await fixture({ sessions: 1 });
  const id = context.ids[0];
  const streams = await Promise.all(Array.from({ length: 12 }, () => context.stream(id)));
  await waitUntil(() => context.app.eventBus.listenerCount(id) === 12);
  const first = await context.events.append(id, 'text', { role: 'provider', content: 'first' });
  await waitUntil(() =>
    streams.every((stream) => stream.events.some((event) => event.id === first)),
  );
  for (const stream of streams) stream.close();
  await waitUntil(() => context.app.eventBus.listenerCount(id) === 0, 'SSE listener cleanup');
  const gap = await context.events.append(id, 'text', {
    role: 'provider',
    content: 'missed while disconnected',
  });
  const reconnect = await context.stream(id, first);
  await waitUntil(() => reconnect.events.some((event) => event.id === gap));
  const live = await context.events.append(id, 'text', {
    role: 'provider',
    content: 'live after reconnect',
  });
  await waitUntil(() => reconnect.events.some((event) => event.id === live));
  expect(reconnect.events.map((event) => event.id)).toEqual([gap, live]);
  reconnect.close();
  await waitUntil(() => context.app.eventBus.listenerCount(id) === 0);
}, 15_000);
