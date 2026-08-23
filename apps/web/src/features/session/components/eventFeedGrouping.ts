import type { ACPEventRow } from '@agentctl/shared';
import { isACPEventText } from '@agentctl/shared';

export type FeedEventGroup =
  | { type: 'user'; event: ACPEventRow; isStreaming: boolean }
  | { type: 'agent'; events: ACPEventRow[]; isStreaming: boolean; id: string }
  | { type: 'command'; event: ACPEventRow; isStreaming: boolean }
  | { type: 'elicitation'; event: ACPEventRow; isStreaming: boolean };

export function groupFeedEvents(
  events: ACPEventRow[],
  streamingEventId: number | null | undefined,
  isSessionRunning?: boolean,
): FeedEventGroup[] {
  const result: FeedEventGroup[] = [];
  let currentAgentTurn: {
    type: 'agent';
    events: ACPEventRow[];
    isStreaming: boolean;
    id: string;
  } | null = null;

  for (const e of events) {
    const statusVal = (e.data as { status?: string } | null)?.status;
    const isHiddenSystemEvent =
      e.type === 'status' &&
      typeof statusVal === 'string' &&
      [
        'available_commands_update',
        'config_option_update',
        'session_info_update',
        'turn_end',
      ].includes(statusVal);

    if (isHiddenSystemEvent) {
      continue;
    }

    const isStreaming = e.id === streamingEventId;

    if (e.type === 'status' && (e.data as { status?: string }).status === 'command_result') {
      currentAgentTurn = null;
      result.push({ type: 'command', event: e, isStreaming });
      continue;
    }

    if (e.type === 'status' && (e.data as { status?: string }).status === 'elicitation_requested') {
      currentAgentTurn = null;
      result.push({ type: 'elicitation', event: e, isStreaming });
      continue;
    }

    const isUser = isACPEventText(e) && e.data.role === 'user';

    if (isUser) {
      currentAgentTurn = null;
      result.push({ type: 'user', event: e, isStreaming });
    } else {
      if (!currentAgentTurn) {
        currentAgentTurn = {
          type: 'agent',
          events: [e],
          isStreaming,
          id: `agent-turn-${String(e.id)}`,
        };
        result.push(currentAgentTurn);
      } else {
        currentAgentTurn.events.push(e);
        if (isStreaming) currentAgentTurn.isStreaming = true;
      }
    }
  }

  if (isSessionRunning) {
    const lastGroup = result[result.length - 1];
    if (lastGroup?.type === 'user') {
      result.push({
        type: 'agent',
        events: [],
        isStreaming: true,
        id: 'agent-turn-optimistic',
      });
    }
  }

  return result;
}
