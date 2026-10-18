import { context, metrics, trace, SpanStatusCode } from '@opentelemetry/api';
import type { TurnTimings } from '@agentctl/shared';
import { emitOperationalEvent, type TurnOutcome } from './logs.js';

export type { TurnOutcome } from './logs.js';

/** Operational timings only. Turn content, provider/session IDs and error text stay local. */
export class TurnObservation {
  private readonly span = trace.getTracer('agentctl.turn').startSpan('agent.turn');
  private readonly activeContext = trace.setSpan(context.active(), this.span);
  private readonly startedAt = performance.now();
  private ended = false;
  run<T>(operation: () => T): T {
    return context.with(this.activeContext, operation);
  }
  phase(phase: 'dispatched' | 'prompt_accepted' | 'first_output'): void {
    if (!this.ended) {
      this.span.addEvent(`agent.${phase}`);
      emitOperationalEvent(`agent.turn.${phase}`, {}, this.activeContext);
    }
  }
  finish(outcome: TurnOutcome, timings: TurnTimings): void {
    if (this.ended) return;
    this.ended = true;
    const attributes = { 'agentctl.turn.outcome': outcome };
    const meter = metrics.getMeter('agentctl.turn');
    meter
      .createHistogram('agentctl.turn.duration', { unit: 's' })
      .record(Math.max(0, performance.now() - this.startedAt) / 1000, attributes);
    const phaseDuration = meter.createHistogram('agentctl.turn.phase.duration', { unit: 's' });
    for (const [phase, milliseconds] of Object.entries(timings)) {
      if (
        !['preparationMs', 'acceptanceMs', 'firstOutputMs', 'completionMs'].includes(phase) ||
        typeof milliseconds !== 'number' ||
        !Number.isFinite(milliseconds) ||
        milliseconds < 0
      )
        continue;
      phaseDuration.record(milliseconds / 1000, {
        ...attributes,
        'agentctl.turn.phase': phase.replace(/Ms$/, ''),
      });
    }
    this.span.setAttribute('agentctl.turn.outcome', outcome);
    if (outcome === 'error') this.span.setStatus({ code: SpanStatusCode.ERROR });
    emitOperationalEvent(
      'agent.turn.finished',
      attributes,
      this.activeContext,
      outcome === 'error' ? 'error' : 'info',
    );
    this.span.end();
  }
}
