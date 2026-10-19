import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import type { MeterProvider } from '@opentelemetry/sdk-metrics';

/** Process measurements only; no process ID, executable, host or environment attributes. */
export function startProcessMetrics(provider: MeterProvider): () => void {
  const meter = provider.getMeter('agentctl.process');
  const memory = meter.createObservableGauge('agentctl.process.memory', { unit: 'By' });
  const cpu = meter.createObservableCounter('agentctl.process.cpu.time', { unit: 's' });
  const utilization = meter.createObservableGauge('agentctl.process.event_loop.utilization', {
    unit: '1',
  });
  const delay = meter.createObservableGauge('agentctl.process.event_loop.delay', { unit: 's' });
  const histogram = monitorEventLoopDelay({ resolution: 20 });
  let previous = performance.eventLoopUtilization();
  histogram.enable();
  const collect: Parameters<typeof meter.addBatchObservableCallback>[0] = (result) => {
    const usage = process.memoryUsage();
    for (const [kind, bytes] of Object.entries({
      rss: usage.rss,
      heap_used: usage.heapUsed,
      heap_total: usage.heapTotal,
      external: usage.external,
    }))
      result.observe(memory, bytes, { 'agentctl.process.memory.kind': kind });
    const cpuUsage = process.cpuUsage();
    result.observe(cpu, cpuUsage.user / 1e6, { 'agentctl.process.cpu.mode': 'user' });
    result.observe(cpu, cpuUsage.system / 1e6, { 'agentctl.process.cpu.mode': 'system' });
    const current = performance.eventLoopUtilization();
    result.observe(utilization, performance.eventLoopUtilization(current, previous).utilization);
    previous = current;
    if (histogram.count > 0) {
      result.observe(delay, histogram.percentile(99) / 1e9, {
        'agentctl.process.event_loop.statistic': 'p99',
      });
      result.observe(delay, histogram.max / 1e9, {
        'agentctl.process.event_loop.statistic': 'max',
      });
    }
    histogram.reset();
  };
  const instruments = [memory, cpu, utilization, delay];
  meter.addBatchObservableCallback(collect, instruments);
  return () => {
    histogram.disable();
    meter.removeBatchObservableCallback(collect, instruments);
  };
}
