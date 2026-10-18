import {
  context,
  trace,
  metrics,
  isSpanContextValid,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  type Context,
} from '@opentelemetry/api';
import { emitOperationalEvent, type TurnOutcome } from './logs.js';

/** Carry only W3C version-00 trace IDs and the sampling bit, without baggage/tracestate. */
export function captureTraceparent(): string | undefined {
  const span = trace.getSpanContext(context.active());
  if (!span || !isSpanContextValid(span)) return undefined;
  return `00-${span.traceId}-${span.spanId}-${(span.traceFlags & 1) === 1 ? '01' : '00'}`;
}

export function restoreTraceContext(value: string | null | undefined): Context {
  const match =
    typeof value === 'string' && /^00-([a-f0-9]{32})-([a-f0-9]{16})-([a-f0-9]{2})$/.exec(value);
  if (!match) return ROOT_CONTEXT;
  const span = {
    traceId: match[1],
    spanId: match[2],
    traceFlags: parseInt(match[3], 16) & 1,
    isRemote: true,
  };
  return isSpanContextValid(span) ? trace.setSpanContext(ROOT_CONTEXT, span) : ROOT_CONTEXT;
}

export function observeQueueSend<T>(send: (traceparent: string | undefined) => T): T {
  const span = trace.getTracer('agentctl.queue').startSpan('session.queue.send', {
    kind: SpanKind.PRODUCER,
    attributes: {
      'messaging.system': 'sqlite',
      'messaging.destination.name': 'session.operations',
      'messaging.operation.type': 'send',
    },
  });
  try {
    return context.with(trace.setSpan(context.active(), span), () => {
      const result = send(captureTraceparent());
      emitOperationalEvent('queue.accepted');
      return result;
    });
  } catch (error) {
    span.setStatus({ code: SpanStatusCode.ERROR });
    throw error;
  } finally {
    span.end();
  }
}

export async function observeQueueProcess<T>(
  traceparent: string | null,
  createdAt: Date,
  process: () => Promise<T>,
): Promise<T> {
  // Never inherit the worker's ambient context: it may belong to another queued request.
  const parent = restoreTraceContext(traceparent);
  const span = trace.getTracer('agentctl.queue').startSpan(
    'session.queue.process',
    {
      kind: SpanKind.CONSUMER,
      attributes: {
        'messaging.system': 'sqlite',
        'messaging.destination.name': 'session.operations',
        'messaging.operation.type': 'process',
      },
    },
    parent,
  );
  return context.with(trace.setSpan(parent, span), async () => {
    metrics
      .getMeter('agentctl.queue')
      .createHistogram('agentctl.queue.wait.duration', { unit: 's' })
      .record(Math.max(0, Date.now() - createdAt.getTime()) / 1000);
    emitOperationalEvent('queue.processing');
    try {
      return await process();
    } catch (error) {
      markQueueFailure();
      throw error;
    } finally {
      emitOperationalEvent('queue.finished');
      span.end();
    }
  });
}

export function markQueueFailure(): void {
  trace.getActiveSpan()?.setStatus({ code: SpanStatusCode.ERROR });
  emitOperationalEvent('queue.failed', {}, context.active(), 'error');
}

/** The client span covers provider acceptance through foreground completion for both ACP versions. */
export async function observeProviderPrompt<T extends { stopReason: string; error?: unknown }>(
  adapter: 'acp-v1' | 'acp-v2',
  prompt: () => Promise<T>,
): Promise<T> {
  const attributes = { 'agentctl.agent.adapter': adapter };
  return trace.getTracer('agentctl.provider').startActiveSpan(
    'agent.provider.prompt',
    {
      kind: SpanKind.CLIENT,
      attributes,
    },
    async (span) => {
      let outcome: TurnOutcome = 'error';
      emitOperationalEvent('provider.prompt.started', attributes);
      try {
        const result = await prompt();
        outcome = result.error
          ? 'error'
          : result.stopReason === 'cancelled'
            ? 'cancelled'
            : 'success';
        return result;
      } finally {
        span.setAttribute('agentctl.turn.outcome', outcome);
        if (outcome === 'error') span.setStatus({ code: SpanStatusCode.ERROR });
        emitOperationalEvent(
          'provider.prompt.finished',
          { ...attributes, 'agentctl.turn.outcome': outcome },
          context.active(),
          outcome === 'error' ? 'error' : 'info',
        );
        span.end();
      }
    },
  );
}
