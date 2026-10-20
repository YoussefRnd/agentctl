import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { and, count, eq, inArray } from 'drizzle-orm';
import { sessionOperations } from '@agentctl/core/db';
import { BenchmarkClient } from './client-process.js';
import { createBackendFixture, seedHistory, waitUntil } from './fixture.js';

const [output, duration, directory] = process.argv.slice(2);
const seconds = Number(duration);
assert(output && directory && Number.isFinite(seconds) && seconds >= 1 && seconds <= 3600);
process.env.AGENTCTL_HOME = join(directory, 'home');
process.env.AGENTCTL_TELEMETRY = '0';
const fixture = await createBackendFixture({ sessions: 20, database: join(directory, 'soak.db') });
const client = new BenchmarkClient();
const lag = monitorEventLoopDelay({ resolution: 10 });
let timer: ReturnType<typeof setInterval> | undefined;
try {
  seedHistory(fixture, 200);
  await client.setup(fixture.url, fixture.ids);
  await fixture.worker.idleAll();
  // Fixture bookkeeping must not become a load-generator memory leak.
  fixture.dispatches.length = 0;
  const outstanding = fixture.db
    .select({ status: sessionOperations.status, count: count() })
    .from(sessionOperations)
    .where(
      and(
        inArray(sessionOperations.sessionId, fixture.ids),
        inArray(sessionOperations.status, ['pending', 'running', 'unknown', 'failed', 'cancelled']),
      ),
    )
    .groupBy(sessionOperations.status)
    .prepare();
  const succeeded = fixture.db
    .select({ count: count() })
    .from(sessionOperations)
    .where(
      and(
        inArray(sessionOperations.sessionId, fixture.ids),
        eq(sessionOperations.status, 'succeeded'),
      ),
    )
    .prepare();
  await waitUntil(() => fixture.ids.every((id) => fixture.app.eventBus.listenerCount(id) === 1));
  const cpu = process.cpuUsage();
  const utilization = performance.eventLoopUtilization();
  const start = performance.now();
  const samples: Array<{
    elapsedMs: number;
    rss: number;
    heapUsed: number;
    external: number;
    pending: number;
    running: number;
    unknown: number;
  }> = [];
  const waves = [];
  const sample = () => {
    const memory = process.memoryUsage();
    const queue = { pending: 0, running: 0, unknown: 0 };
    const statuses = outstanding.all();
    assert(statuses.every((row) => row.status !== 'failed' && row.status !== 'cancelled'));
    for (const row of statuses) queue[row.status as keyof typeof queue] = row.count;
    samples.push({
      elapsedMs: performance.now() - start,
      rss: memory.rss,
      heapUsed: memory.heapUsed,
      external: memory.external,
      ...queue,
    });
  };
  sample();
  lag.enable();
  timer = setInterval(sample, 1000);
  do {
    const began = performance.now();
    const result = await client.run();
    await fixture.worker.idleAll();
    assert.equal(fixture.dispatches.length, 100);
    for (const id of fixture.ids) {
      const dispatches = fixture.dispatches.filter((row) => row.sessionId === id);
      assert.deepEqual(
        dispatches.map((row) => row.command),
        Array.from({ length: 5 }, (_, turn) => `synthetic turn ${turn}`),
      );
      assert(
        dispatches.every(
          (row, i) =>
            row.ended !== undefined && (i === 0 || dispatches[i - 1].ended! <= row.started),
        ),
      );
      assert.equal(fixture.app.eventBus.listenerCount(id), 1);
    }
    assert.equal(outstanding.all().length, 0);
    fixture.dispatches.length = 0;
    waves.push({
      elapsedMs: performance.now() - start,
      durationMs: performance.now() - began,
      acceptMs: result.acceptMs,
      historyMs: result.historyMs,
      firstOutputMs: result.firstOutputMs,
      completionMs: result.completionMs,
    });
  } while (performance.now() - start < seconds * 1000);
  assert.equal(succeeded.get()!.count, 20 + waves.length * 100);
  clearInterval(timer);
  lag.disable();
  sample();
  const elapsedMs = performance.now() - start;
  const cpuUsage = process.cpuUsage(cpu);
  const eventLoop = {
    utilization: performance.eventLoopUtilization(utilization).utilization,
    delayP99Ms: lag.count ? lag.percentile(99) / 1e6 : null,
    delayMaxMs: lag.count ? lag.max / 1e6 : null,
  };
  assert.equal(await client.close(), 0);
  await waitUntil(() => fixture.ids.every((id) => fixture.app.eventBus.listenerCount(id) === 0));
  // Natural-GC low-water marks show retained-memory trends without forcing collection.
  const windows = Array.from({ length: Math.floor(elapsedMs / 30_000) + 1 }, (_, i) => {
    const group = samples.filter((value) => Math.floor(value.elapsedMs / 30_000) === i);
    return group.length
      ? {
          startMs: i * 30_000,
          samples: group.length,
          minHeapUsed: Math.min(...group.map((value) => value.heapUsed)),
          minRss: Math.min(...group.map((value) => value.rss)),
        }
      : undefined;
  }).filter((value) => value !== undefined);
  await writeFile(
    output,
    JSON.stringify(
      {
        schemaVersion: 1,
        passed: true,
        workload: {
          sessionCount: 20,
          seconds,
          historyEventsPerSession: 200,
          telemetry: 'disabled',
          clients: 'separate-process',
          persistentSseConnections: 20,
        },
        elapsedMs,
        turns: waves.length * 100,
        maxConcurrentTurns: fixture.maxActive,
        cpuMs: { user: cpuUsage.user / 1000, system: cpuUsage.system / 1000 },
        eventLoop,
        finalOutstanding: 0,
        finalListeners: 0,
        samples,
        windows,
        waves,
      },
      null,
      2,
    ) + '\n',
  );
} finally {
  clearInterval(timer);
  lag.disable();
  await client.close();
  await fixture.close();
}
