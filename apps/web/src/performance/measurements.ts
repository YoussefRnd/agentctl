import { groupFeedEvents, groupConversationTurns } from '@/features/conversation';
import { splitStreamingContent } from '../shared/markdown/ui/streamingMarkdownUtils';
import { splitGraphemes } from '../shared/markdown/ui/StreamingMarkdown';
import { mergeEventHistory } from '@/features/sessions';
import { conversationFixture, markdownFixture } from './fixtures';

export function summarize(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (fraction: number) =>
    sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
  return {
    count: sorted.length,
    p50: percentile(0.5),
    p75: percentile(0.75),
    p95: percentile(0.95),
    max: sorted.at(-1)!,
  };
}

export async function cpuBaselines() {
  const results = [];
  for (const size of [2048, 32768]) {
    const content = markdownFixture('code-table', size);
    for (const [name, fn] of [
      ['split-streaming-content', () => splitStreamingContent(content)],
      ['segment-graphemes', () => splitGraphemes(content)],
    ] as const)
      results.push(await sampleCpu(name, content.length, fn));
  }
  for (const size of [200, 1000]) {
    const events = conversationFixture(size);
    const last = events.at(-1)!;
    for (const [name, fn] of [
      ['group-feed-events', () => groupFeedEvents(events, null, false)],
      ['group-conversation-turns', () => groupConversationTurns(events)],
      ['merge-event-history', () => mergeEventHistory([], [...events.slice(0, -1), { ...last }])],
    ] as const)
      results.push(await sampleCpu(name, events.length, fn));
  }
  return results;
}

async function sampleCpu(name: string, inputSize: number, fn: () => unknown) {
  for (let warmup = 0; warmup < 10; warmup++) fn();
  let iterations = 1;
  while (iterations < 1024) {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) fn();
    if (performance.now() - start >= 20) break;
    iterations *= 2;
  }
  const samples = [];
  for (let sample = 0; sample < 9; sample++) {
    // Yield between samples; CPU timings never include this wait.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const start = performance.now();
    for (let i = 0; i < iterations; i++) fn();
    samples.push((performance.now() - start) / iterations);
  }
  return {
    name,
    inputSize,
    iterationsPerSample: iterations,
    millisecondsPerOperation: summarize(samples),
  };
}

export function createBrowserProbe() {
  const startedAt = performance.now();
  const frames: number[] = [];
  const tasks: { startTime: number; duration: number }[] = [];
  const commits: Record<string, { count: number; totalMs: number; maxMs: number }> = {};
  const phases = [{ name: 'mount', startedAt, commits: {} as typeof commits }];
  let previousFrame: number | undefined;
  let frame = 0;
  let mutationRecords = 0;
  let active = true;
  const tick = (now: number) => {
    if (!active) return;
    if (previousFrame !== undefined) frames.push(now - previousFrame);
    previousFrame = now;
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  const supported = PerformanceObserver.supportedEntryTypes.includes('longtask');
  const consume = (entries: PerformanceEntry[]) => {
    for (const entry of entries) {
      if (entry.startTime >= startedAt)
        tasks.push({ startTime: entry.startTime, duration: entry.duration });
    }
  };
  const observer = supported ? new PerformanceObserver((list) => consume(list.getEntries())) : null;
  observer?.observe({ type: 'longtask' });
  const mutations = new MutationObserver((records) => {
    mutationRecords += records.length;
  });
  const workload = document.getElementById('performance-workload');
  if (workload)
    mutations.observe(workload, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
  const taskSummary = (entries: typeof tasks) =>
    supported
      ? {
          count: entries.length,
          totalMs: entries.reduce((sum, entry) => sum + entry.duration, 0),
          blockingMs: entries.reduce((sum, entry) => sum + Math.max(0, entry.duration - 50), 0),
          maxMs: Math.max(0, ...entries.map((entry) => entry.duration)),
        }
      : null;
  const addCommit = (collection: typeof commits, id: string, duration: number) => {
    const previous = collection[id] ?? { count: 0, totalMs: 0, maxMs: 0 };
    collection[id] = {
      count: previous.count + 1,
      totalMs: previous.totalMs + duration,
      maxMs: Math.max(previous.maxMs, duration),
    };
  };
  return {
    setPhase(name: string) {
      phases.push({ name, startedAt: performance.now(), commits: {} });
    },
    onRender(id: string, _phase: string, actualDuration: number) {
      addCommit(commits, id, actualDuration);
      addCommit(phases.at(-1)!.commits, id, actualDuration);
    },
    stop() {
      active = false;
      cancelAnimationFrame(frame);
      if (observer) consume(observer.takeRecords());
      observer?.disconnect();
      mutationRecords += mutations.takeRecords().length;
      mutations.disconnect();
      const endedAt = performance.now();
      return {
        elapsedMs: endedAt - startedAt,
        frameGapMs: summarize(frames),
        frameGapsOver34Ms: frames.filter((gap) => gap > 34).length,
        longTasks: taskSummary(tasks),
        commits,
        mutationRecords,
        phases: phases.map((phase, index) => {
          const end = phases[index + 1]?.startedAt ?? endedAt;
          return {
            name: phase.name,
            elapsedMs: end - phase.startedAt,
            commits: phase.commits,
            longTasks: taskSummary(
              tasks.filter((task) => task.startTime >= phase.startedAt && task.startTime < end),
            ),
          };
        }),
      };
    },
  };
}
