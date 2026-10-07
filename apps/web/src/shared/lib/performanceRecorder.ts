export type JourneyName =
  | 'launch-to-typeable'
  | 'session-click-to-feed-painted'
  | 'send-to-first-text-received'
  | 'send-to-first-text-painted'
  | 'first-text-received-to-painted';

export interface JourneySample {
  name: JourneyName;
  startTime: number;
  durationMs: number;
}

/** Opt-in, bounded, local measurements. Scopes never appear in exported samples. */
export class PerformanceRecorder {
  private pending = new Map<string, { name: JourneyName; startTime: number }>();
  private samples: JourneySample[] = [];

  constructor(
    readonly enabled: boolean,
    private clock = () => performance.now(),
  ) {}

  begin(name: JourneyName, scope = '', startTime = this.clock()): void {
    if (!this.enabled) return;
    const key = `${name}:${scope}`;
    this.pending.set(key, { name, startTime });
    if (this.pending.size > 128) this.pending.delete(this.pending.keys().next().value!);
  }

  finish(name: JourneyName, scope = '', finishedAt?: number): void {
    const key = `${name}:${scope}`;
    const pending = this.pending.get(key);
    if (!pending) return;
    this.pending.delete(key);
    this.samples.push({
      ...pending,
      durationMs: Math.max(0, (finishedAt ?? this.clock()) - pending.startTime),
    });
    if (this.samples.length > 200) this.samples.shift();
  }

  cancel(name: JourneyName, scope = ''): void {
    this.pending.delete(`${name}:${scope}`);
  }

  snapshot(): JourneySample[] {
    return this.samples.map((sample) => ({ ...sample }));
  }

  clear(): void {
    this.pending.clear();
    this.samples = [];
  }
}

const optedIn =
  typeof window !== 'undefined' &&
  (new URLSearchParams(window.location.search).get('perf') === '1' ||
    new URLSearchParams(window.location.hash.split('?')[1]).get('perf') === '1');

export const journeyPerformance = new PerformanceRecorder(optedIn);

/** Two animation frames approximate a paint opportunity, not physical display presentation. */
export function afterPaint(callback: () => void): () => void {
  let active = true;
  let frame = requestAnimationFrame(() => {
    frame = requestAnimationFrame(() => {
      if (active) callback();
    });
  });
  return () => {
    active = false;
    cancelAnimationFrame(frame);
  };
}

if (optedIn) {
  Object.defineProperty(window, 'agentctlPerformance', {
    configurable: true,
    value: {
      snapshot: () => journeyPerformance.snapshot(),
      clear: () => journeyPerformance.clear(),
    },
  });
}
