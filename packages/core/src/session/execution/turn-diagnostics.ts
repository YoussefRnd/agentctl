import type { TurnTimings } from '@agentctl/shared';
import type { AgentUpdate } from '../../agent/types.js';

/** Durations use a monotonic clock. Unknown phases stay absent, notably v1 acceptance. */
export class TurnDiagnostics {
  private readonly startedAt: number;
  private dispatchedAt?: number;
  private timings: TurnTimings = {};

  constructor(private clock = () => performance.now()) {
    this.startedAt = clock();
  }

  dispatch(): void {
    if (this.dispatchedAt !== undefined) return;
    this.dispatchedAt = this.clock();
    this.timings.preparationMs = Math.max(0, this.dispatchedAt - this.startedAt);
  }

  observe(event: AgentUpdate): 'prompt_accepted' | 'first_output' | undefined {
    if (this.dispatchedAt === undefined || this.timings.completionMs !== undefined) return;
    const elapsed = Math.max(0, this.clock() - this.dispatchedAt);
    if (event.type === 'user_message_accepted' && this.timings.acceptanceMs === undefined) {
      this.timings.acceptanceMs = elapsed;
      return 'prompt_accepted';
    }
    const output =
      ((event.type === 'text' || event.type === 'thought') && event.text.length > 0) ||
      event.type === 'tool_call' ||
      event.type === 'subagent_event' ||
      (event.type === 'terminal_output' && event.data.length > 0);
    if (output && this.timings.firstOutputMs === undefined) {
      this.timings.firstOutputMs = elapsed;
      return 'first_output';
    }
  }

  finish(): TurnTimings {
    if (this.dispatchedAt !== undefined)
      this.timings.completionMs ??= Math.max(0, this.clock() - this.dispatchedAt);
    else this.timings.preparationMs ??= Math.max(0, this.clock() - this.startedAt);
    return this.snapshot();
  }

  snapshot(): TurnTimings {
    return { ...this.timings };
  }
}
