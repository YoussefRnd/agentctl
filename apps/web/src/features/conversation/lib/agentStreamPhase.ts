import { isSessionEventText, isSessionEventToolCall, type SessionEventRow } from '@agentctl/shared';

export type AgentStreamPhase = 'idle' | 'thinking' | 'tool' | 'responding';

export function getAgentStreamPhase(events: SessionEventRow[]): AgentStreamPhase {
  let phase: AgentStreamPhase = 'idle';

  for (const event of events) {
    if (isSessionEventText(event)) {
      if (event.data.role === 'provider') phase = 'responding';
      else if (event.data.role === 'thought') phase = 'thinking';
    } else if (isSessionEventToolCall(event) || event.type === 'approval_request') {
      phase = 'tool';
    }
  }

  return phase;
}
