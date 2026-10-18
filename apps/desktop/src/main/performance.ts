import { metrics } from '@opentelemetry/api';

const phases = new Set([
  'desktop-process-to-app-ready',
  'desktop-server-start-to-ready',
  'desktop-window-create-to-ready',
  'desktop-process-to-window-ready',
]);

/** Records bounded startup phases; JSON profiling and the telemetry SDK are independently opt-in. */
export function reportDesktopPerformance(name: string, startedAt = 0): void {
  const durationMs = Math.max(0, performance.now() - startedAt);
  if (phases.has(name))
    metrics
      .getMeter('agentctl.desktop')
      .createHistogram('agentctl.desktop.startup.duration', { unit: 's' })
      .record(durationMs / 1000, { 'agentctl.desktop.phase': name });
  if (process.env.AGENTCTL_PERF !== '1') return;
  process.stdout.write(
    JSON.stringify({
      type: 'agentctl_performance',
      name,
      durationMs,
    }) + '\n',
  );
}
