import { context, type Context } from '@opentelemetry/api';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import { agentDiagnosticEventSchema } from '@agentctl/shared';
import { z } from 'zod';

const outcomeSchema = z.enum(['success', 'error', 'cancelled']);
export type TurnOutcome = z.infer<typeof outcomeSchema>;
const eventSchema = z.enum([
  'agent.connection',
  'agent.turn.dispatched',
  'agent.turn.prompt_accepted',
  'agent.turn.first_output',
  'agent.turn.finished',
  'queue.accepted',
  'queue.processing',
  'queue.failed',
  'queue.finished',
  'provider.prompt.started',
  'provider.prompt.finished',
]);
type OperationalEvent = z.infer<typeof eventSchema>;
const attributesSchema = z
  .object({
    'agentctl.turn.outcome': outcomeSchema,
    'agentctl.agent.event': agentDiagnosticEventSchema.shape.kind,
    'agentctl.agent.adapter': agentDiagnosticEventSchema.shape.adapter,
    'agentctl.agent.reason': agentDiagnosticEventSchema.shape.reason,
    'agentctl.agent.path': agentDiagnosticEventSchema.shape.path,
    'agentctl.agent.intent': agentDiagnosticEventSchema.shape.intent,
  })
  .partial();
type OperationalAttributes = z.input<typeof attributesSchema>;

/** Fixed event names and bounded classifications; never accept content or exception objects. */
export function emitOperationalEvent(
  event: OperationalEvent,
  attributes: OperationalAttributes = {},
  activeContext: Context = context.active(),
  severity: 'info' | 'error' = 'info',
): void {
  const logger = logs.getLogger('agentctl.operations');
  const severityNumber = severity === 'error' ? SeverityNumber.ERROR : SeverityNumber.INFO;
  if (
    !logger.enabled({ eventName: event, severityNumber, context: activeContext }) ||
    !eventSchema.safeParse(event).success
  )
    return;
  const parsed = attributesSchema.safeParse(attributes);
  logger.emit({
    eventName: event,
    body: event,
    attributes: parsed.success ? parsed.data : {},
    context: activeContext,
    severityNumber,
    severityText: severity.toUpperCase(),
  });
}
