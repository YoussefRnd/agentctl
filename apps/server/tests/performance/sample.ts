import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { sessionEvents } from '@agentctl/core/db';
import { startTelemetry } from '../../src/observability/runtime.js';
import { createBackendFixture, waitUntil } from './fixture.js';

const [output, count, mode, historySize, collector, directory] = process.argv.slice(2);
const sessionCount = Number(count);
const historyEvents = Number(historySize);
assert([1, 5, 20].includes(sessionCount));
assert([200, 10_000].includes(historyEvents));
assert(directory, 'The parent runner must own the temporary database directory');
// Own every path and telemetry destination; never open a developer's database or provider catalog.
process.env.AGENTCTL_HOME = join(directory, 'home');
process.env.AGENTCTL_TELEMETRY = mode === 'enabled' ? '1' : '0';
const received = { traces: 0, metrics: 0, logs: 0 };
const receiver = createServer((request, response) => {
  const signal = request.url?.split('/').pop() as keyof typeof received;
  request.resume();
  request.on('end', () => {
    if (signal in received) received[signal]++;
    response.writeHead(200, { 'content-type': 'application/x-protobuf' }).end();
  });
});
await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
const address = receiver.address();
assert(address && typeof address !== 'string');
if (collector !== 'external')
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT = `http://127.0.0.1:${address.port}`;
const setupStarted = performance.now();
const telemetry = await startTelemetry('server');
assert.equal(telemetry.enabled, mode === 'enabled');
let fixture: Awaited<ReturnType<typeof createBackendFixture>> | undefined;
let memoryTimer: ReturnType<typeof setInterval> | undefined;
const lag = monitorEventLoopDelay({ resolution: 10 });
try {
  fixture = await createBackendFixture({
    sessions: sessionCount,
    database: join(directory, 'baseline.db'),
  });
  const context = fixture;
  // Seed outside the measured window. This exercises history queries without timing fixture construction.
  context.db.transaction((tx) => {
    for (const id of context.ids)
      for (let start = 0; start < historyEvents; start += 100) {
        tx.insert(sessionEvents)
          .values(
            Array.from({ length: Math.min(100, historyEvents - start) }, (_, offset) => ({
              sessionId: id,
              type: 'text' as const,
              data: JSON.stringify({
                role: (start + offset) % 2 ? 'provider' : 'user',
                content: 'Synthetic history '.repeat(16),
              }),
            })),
          )
          .run();
      }
  });
  const streams = await Promise.all(context.ids.map((id) => context.stream(id)));
  await waitUntil(() => context.ids.every((id) => context.app.eventBus.listenerCount(id) === 1));
  // Warm lazy/JIT paths in this process, then discard the turn and its SSE frames.
  await Promise.all(
    context.ids.map(async (id) => {
      await context.send(id, 'discarded warmup turn');
      const response = await fetch(`${context.url}/api/sessions/${id}/events/page?limit=200`);
      assert.equal(response.status, 200);
      await response.arrayBuffer();
    }),
  );
  await waitUntil(() => context.operations().every((row) => row.status === 'succeeded'));
  await waitUntil(() =>
    streams.every((stream) =>
      stream.events.some((event) => (event.data.data as { status?: string }).status === 'turn_end'),
    ),
  );
  const dispatchOffset = context.dispatches.length;
  for (const stream of streams) stream.events.length = 0;
  const setupMs = performance.now() - setupStarted;
  const acceptMs: number[] = [];
  const historyMs: number[] = [];
  const started = new Map<string, number>();
  const memoryBefore = process.memoryUsage();
  let peakRss = memoryBefore.rss;
  let peakHeap = memoryBefore.heapUsed;
  memoryTimer = setInterval(() => {
    const usage = process.memoryUsage();
    peakRss = Math.max(peakRss, usage.rss);
    peakHeap = Math.max(peakHeap, usage.heapUsed);
  }, 20);
  lag.enable();
  await delay(25);
  lag.reset();
  const cpu = process.cpuUsage();
  const utilization = performance.eventLoopUtilization();
  const start = performance.now();
  const turnsPerSession = 5;
  await Promise.all(
    context.ids.map(async (id) => {
      for (let turn = 0; turn < turnsPerSession; turn++) {
        const text = `synthetic turn ${turn}`;
        const sent = performance.now();
        started.set(`${id}:${text}`, sent);
        await context.send(id, text);
        acceptMs.push(performance.now() - sent);
        const historyStart = performance.now();
        const response = await fetch(`${context.url}/api/sessions/${id}/events/page?limit=200`, {
          signal: AbortSignal.timeout(15_000),
        });
        const page = (await response.json()) as { events: unknown[]; nextBeforeId: number | null };
        assert.equal(response.status, 200);
        assert(page.events.length > 0 && page.events.length <= 201);
        assert(page.nextBeforeId !== null, 'Large history must retain a usable cursor');
        historyMs.push(performance.now() - historyStart);
      }
    }),
  );
  const turns = sessionCount * turnsPerSession;
  await waitUntil(
    () =>
      context.operations().length === turns + sessionCount &&
      context.operations().every((row) => row.status === 'succeeded'),
    'all accepted turns completed',
    30_000,
  );
  await waitUntil(
    () =>
      streams.every(
        (stream) =>
          stream.events.filter(
            (event) => (event.data.data as { status?: string }).status === 'turn_end',
          ).length === turnsPerSession,
      ),
    'all turn completions reached SSE',
    15_000,
  );
  const firstOutputMs: number[] = [];
  for (const [index, stream] of streams.entries()) {
    const prompts = new Map<number, string>();
    const text = new Map<number, string>();
    for (const event of stream.events) {
      const payload = event.data.data as { role?: string; content?: string };
      if (payload.role === 'user') prompts.set(event.id, payload.content!);
      if (payload.role !== 'provider') continue;
      if (!text.has(event.id))
        firstOutputMs.push(
          event.receivedAt -
            started.get(
              `${context.ids[index]}:${prompts.get(event.data.parentEventId as number)}`,
            )!,
        );
      text.set(
        event.id,
        event.data.delta === undefined
          ? payload.content!
          : (text.get(event.id) ?? '') + String(event.data.delta),
      );
    }
    assert.equal(text.size, turnsPerSession);
    for (const content of text.values())
      assert.equal(
        content,
        'synthetic output '.repeat(20),
        'SSE must reconstruct the entire batched response',
      );
  }
  const elapsedMs = performance.now() - start;
  const cpuUsage = process.cpuUsage(cpu);
  const eventLoopUtilization = performance.eventLoopUtilization(utilization).utilization;
  const memoryAfter = process.memoryUsage();
  peakRss = Math.max(peakRss, memoryAfter.rss);
  peakHeap = Math.max(peakHeap, memoryAfter.heapUsed);
  clearInterval(memoryTimer);
  lag.disable();
  const dispatches = context.dispatches.slice(dispatchOffset);
  let activeTurns = 0;
  let maxConcurrentTurns = 0;
  for (const point of dispatches
    .flatMap((dispatch) => [
      { time: dispatch.started, delta: 1 },
      { time: dispatch.ended!, delta: -1 },
    ])
    .sort((a, b) => a.time - b.time || a.delta - b.delta)) {
    activeTurns += point.delta;
    maxConcurrentTurns = Math.max(maxConcurrentTurns, activeTurns);
  }
  const durations = dispatches.map(
    (dispatch) => dispatch.ended! - started.get(`${dispatch.sessionId}:${dispatch.command}`)!,
  );
  assert.equal(dispatches.length, turns);
  assert.equal(new Set(context.operations().map((row) => row.eventId)).size, turns + sessionCount);
  assert(firstOutputMs.every((value) => Number.isFinite(value) && value >= 0));
  for (const id of context.ids)
    assert.deepEqual(
      dispatches.filter((row) => row.sessionId === id).map((row) => row.command),
      Array.from({ length: turnsPerSession }, (_, turn) => `synthetic turn ${turn}`),
    );
  for (const stream of streams) stream.close();
  await waitUntil(
    () => context.ids.every((id) => context.app.eventBus.listenerCount(id) === 0),
    'SSE cleanup',
  );
  await context.close();
  fixture = undefined;
  await telemetry.shutdown();
  if (mode === 'enabled' && collector !== 'external')
    assert(
      Object.values(received).every((value) => value > 0),
      'Every telemetry signal must reach the receiver',
    );
  const percentile = (values: number[], p: number) =>
    [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * p) - 1)];
  const summarize = (values: number[]) => ({
    count: values.length,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: Math.max(...values),
  });
  await writeFile(
    output,
    JSON.stringify(
      {
        schemaVersion: 1,
        passed: true,
        workload: {
          sessionCount,
          turnsPerSession,
          chunksPerTurn: 20,
          historyEventsPerSession: historyEvents,
          telemetry: mode,
        },
        setupMs,
        elapsedMs,
        turnsPerSecond: turns / (elapsedMs / 1000),
        maxConcurrentTurns,
        acceptMs: summarize(acceptMs),
        historyMs: summarize(historyMs),
        firstOutputMs: summarize(firstOutputMs),
        completionMs: summarize(durations),
        cpuMs: { user: cpuUsage.user / 1000, system: cpuUsage.system / 1000 },
        memoryBytes: { beforeRss: memoryBefore.rss, afterRss: memoryAfter.rss, peakRss, peakHeap },
        eventLoop: {
          utilization: eventLoopUtilization,
          delayP99Ms: lag.count ? lag.percentile(99) / 1e6 : null,
          delayMaxMs: lag.count ? lag.max / 1e6 : null,
        },
        telemetryBatches: received,
      },
      null,
      2,
    ) + '\n',
  );
} finally {
  clearInterval(memoryTimer);
  lag.disable();
  await fixture?.close();
  await telemetry.shutdown();
  receiver.closeAllConnections();
  await new Promise<void>((resolve) => receiver.close(() => resolve()));
}
