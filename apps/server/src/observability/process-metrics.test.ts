import { expect, test, vi } from 'vite-plus/test';
import {
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
  AggregationTemporality,
} from '@opentelemetry/sdk-metrics';
import { startProcessMetrics } from './process-metrics.js';

test('collects bounded process metrics and releases the observable callback', async () => {
  const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 });
  const provider = new MeterProvider({ readers: [reader] });
  const memoryUsage = vi.spyOn(process, 'memoryUsage');
  const stop = startProcessMetrics(provider);
  try {
    await new Promise((resolve) => setTimeout(resolve, 60));
    const collected = await reader.collect();
    const metrics = collected.resourceMetrics.scopeMetrics.flatMap((scope) => scope.metrics);
    expect(metrics.map((metric) => metric.descriptor.name).sort()).toEqual([
      'agentctl.process.cpu.time',
      'agentctl.process.event_loop.delay',
      'agentctl.process.event_loop.utilization',
      'agentctl.process.memory',
    ]);
    for (const metric of metrics)
      for (const point of metric.dataPoints) {
        expect(Number.isFinite(point.value)).toBe(true);
        expect(point.value).toBeGreaterThanOrEqual(0);
        expect(
          Object.keys(point.attributes).every((key) => key.startsWith('agentctl.process.')),
        ).toBe(true);
      }
    stop();
    stop();
    memoryUsage.mockClear();
    await reader.collect();
    // Cumulative readers may retain previous points; cleanup must stop new OS observations.
    expect(memoryUsage).not.toHaveBeenCalled();
  } finally {
    memoryUsage.mockRestore();
    stop();
    await provider.shutdown();
  }
});
