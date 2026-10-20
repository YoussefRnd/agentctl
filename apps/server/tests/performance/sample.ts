import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { startTelemetry } from '../../src/observability/runtime.js';
import { createBackendFixture, seedHistory, waitUntil } from './fixture.js';
import { BenchmarkClient } from './client-process.js';

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
let client: BenchmarkClient | undefined;
try {
  fixture = await createBackendFixture({
    sessions: sessionCount,
    database: join(directory, 'baseline.db'),
  });
  const context = fixture;
  // Seed outside the measured window. This exercises history queries without timing fixture construction.
  seedHistory(context, historyEvents);
  client = new BenchmarkClient();
  await client.setup(context.url, context.ids);
  await context.worker.idleAll();
  await waitUntil(() => context.ids.every((id) => context.app.eventBus.listenerCount(id) === 1));
  const dispatchOffset = context.dispatches.length;
  const setupMs = performance.now() - setupStarted;
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
  const turns = sessionCount * turnsPerSession;
  const result = await client.run();
  await context.worker.idleAll();
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
  assert.equal(dispatches.length, turns);
  const operations = context.operations();
  assert.equal(operations.length, turns + sessionCount);
  assert(operations.every((row) => row.status === 'succeeded'));
  assert.equal(new Set(operations.map((row) => row.eventId)).size, operations.length);
  const eventIds = new Set(operations.map((row) => row.eventId));
  assert.equal(result.receipts.length, turns);
  assert(result.receipts.every((id) => eventIds.has(id)));
  for (const id of context.ids) {
    const dispatched = dispatches.filter((row) => row.sessionId === id);
    assert.deepEqual(
      dispatched.map((row) => row.command),
      Array.from({ length: turnsPerSession }, (_, turn) => `synthetic turn ${turn}`),
    );
    assert(dispatched.every((row, i) => i === 0 || dispatched[i - 1].ended! <= row.started));
  }
  assert.equal(await client.close(), 0, 'Benchmark client must exit cleanly');
  client = undefined;
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
  await writeFile(
    output,
    JSON.stringify(
      {
        schemaVersion: 2,
        measurement: {
          clients: 'separate-process',
          resources: 'server-process',
          completion: 'client-sse-turn-end',
        },
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
        acceptMs: result.acceptMs,
        historyMs: result.historyMs,
        firstOutputMs: result.firstOutputMs,
        completionMs: result.completionMs,
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
  await client?.close();
  await fixture?.close();
  await telemetry.shutdown();
  receiver.closeAllConnections();
  await new Promise<void>((resolve) => receiver.close(() => resolve()));
}
