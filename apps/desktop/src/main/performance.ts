/** Enabled only for an explicit local profiling run; exports durations, never application data. */
export function reportDesktopPerformance(name: string, startedAt = 0): void {
  if (process.env.AGENTCTL_PERF !== '1') return;
  process.stdout.write(
    JSON.stringify({
      type: 'agentctl_performance',
      name,
      durationMs: Math.max(0, performance.now() - startedAt),
    }) + '\n',
  );
}
