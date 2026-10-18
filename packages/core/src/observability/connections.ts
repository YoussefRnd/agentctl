import { metrics } from '@opentelemetry/api';
import type { AgentDiagnosticEvent } from '@agentctl/shared';
import { emitOperationalEvent } from './logs.js';

/** Only bounded connection classifications leave the process; IDs stay in local diagnostics. */
export function recordConnectionEvent(
  event: Pick<AgentDiagnosticEvent, 'kind' | 'adapter' | 'reason' | 'path' | 'intent'>,
): void {
  const attributes = {
    'agentctl.agent.event': event.kind,
    'agentctl.agent.adapter': event.adapter,
    ...(event.reason ? { 'agentctl.agent.reason': event.reason } : {}),
    ...(event.path ? { 'agentctl.agent.path': event.path } : {}),
    ...(event.intent ? { 'agentctl.agent.intent': event.intent } : {}),
  };
  emitOperationalEvent('agent.connection', attributes);
  metrics
    .getMeter('agentctl.agent')
    .createCounter('agentctl.agent.connection.events')
    .add(1, attributes);
}
