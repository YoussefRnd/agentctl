import type { SessionEventRow, SessionExecution, ProviderSwitchData } from '@agentctl/shared';
import { chatErrorSchema, isSessionEventText, providerSwitchDataSchema } from '@agentctl/shared';
import { orderConversationEvents } from './orderConversationEvents';

export type FeedEventGroup =
  | { type: 'user'; event: SessionEventRow; isStreaming: boolean }
  | { type: 'agent'; events: SessionEventRow[]; isStreaming: boolean; id: string }
  | { type: 'notice'; event: SessionEventRow; isStreaming: boolean }
  | {
      type: 'provider_switch';
      event: SessionEventRow;
      change: ProviderSwitchData;
      isStreaming: boolean;
    }
  | { type: 'error'; event: SessionEventRow; isStreaming: boolean }
  | { type: 'command'; event: SessionEventRow; isStreaming: boolean }
  | { type: 'elicitation'; event: SessionEventRow; isStreaming: boolean };

export function hasCurrentChatFailure(
  groups: FeedEventGroup[],
  execution?: SessionExecution,
): boolean {
  const failure = chatErrorSchema.safeParse(execution?.error);
  const lastUser = groups.findLast((group) => group.type === 'user');
  return groups.some((group, index) => {
    if (
      group.type !== 'error' &&
      !(
        group.type === 'notice' &&
        group.event.type === 'status' &&
        group.event.data.status === 'runtime_error'
      )
    )
      return false;
    if (failure.success) {
      const visible =
        group.event.type === 'status'
          ? chatErrorSchema.safeParse(group.event.data.error)
          : undefined;
      return visible?.success === true && visible.data.id === failure.data.id;
    }
    if (execution?.attemptId && group.event.metadata?.attemptId)
      return group.event.metadata.attemptId === execution.attemptId;
    if (execution?.eventId !== undefined) return group.event.parentEventId === execution.eventId;
    // Older servers have no failure identity. Only the latest turn can own the fallback.
    return !lastUser || index > groups.indexOf(lastUser);
  });
}

export function groupFeedEvents(
  events: SessionEventRow[],
  streamingEventId: number | null | undefined,
  isSessionRunning?: boolean,
  providerIcons?: ReadonlyMap<string, string>,
): FeedEventGroup[] {
  const result: FeedEventGroup[] = [];
  let currentAgentTurn: {
    type: 'agent';
    events: SessionEventRow[];
    isStreaming: boolean;
    id: string;
  } | null = null;

  const ordered = orderConversationEvents(events);
  const failureOwners = new Map<string, number>();
  const failureRanks = new Map<string, number>();
  const ownerOf = (event: SessionEventRow, userId: number | undefined) =>
    event.type === 'status' && chatErrorSchema.safeParse(event.data.error).success
      ? `failure:${chatErrorSchema.parse(event.data.error).id}`
      : event.metadata?.attemptId
        ? `attempt:${event.metadata.attemptId}`
        : `input:${event.parentEventId ?? userId ?? 'session'}`;
  let userId: number | undefined;
  for (const event of ordered) {
    if (event.metadata?.nativeSessionId) continue;
    if (isSessionEventText(event) && event.data.role === 'user' && !event.metadata?.nativeSessionId)
      userId = event.id;
    if (
      event.type === 'status' &&
      !event.data.diagnosticOnly &&
      (event.data.status === 'prompt_failed' ||
        event.data.status === 'operation_failed' ||
        event.data.status === 'runtime_error')
    ) {
      const structured = chatErrorSchema.safeParse(event.data.error).success;
      const owners = [ownerOf(event, userId)];
      if (event.metadata?.attemptId) owners.push(`attempt:${event.metadata.attemptId}`);
      // Only old uncorrelated events need input-based deduplication.
      if (!structured) owners.push(`input:${event.parentEventId ?? userId ?? 'session'}`);
      const rank =
        event.data.status === 'prompt_failed'
          ? 2
          : event.data.status === 'operation_failed'
            ? 1
            : 0;
      for (const owner of owners) {
        if (rank >= (failureRanks.get(owner) ?? -1)) {
          failureOwners.set(owner, event.id);
          failureRanks.set(owner, rank);
        }
      }
    }
  }
  userId = undefined;

  for (const e of ordered) {
    if (isSessionEventText(e) && e.data.role === 'user' && !e.metadata?.nativeSessionId)
      userId = e.id;
    // Native child transcripts are inspected through the global roster, including background work.
    if (
      e.metadata?.nativeSessionId &&
      e.type !== 'approval_request' &&
      !(e.type === 'status' && e.data.status === 'elicitation_requested')
    )
      continue;
    const isStreaming = e.id === streamingEventId;
    const statusVal = (e.data as { status?: string } | null)?.status;
    const isHiddenSystemEvent =
      e.type === 'status' &&
      (e.data.diagnosticOnly === true ||
        (typeof statusVal === 'string' &&
          [
            'available_commands_update',
            'config_option_update',
            'session_info_update',
            'turn_started',
            'prompt_accepted',
            'first_output',
          ].includes(statusVal)));

    if (isHiddenSystemEvent) {
      continue;
    }

    if (e.type === 'status' && statusVal === 'provider_switched') {
      const change = providerSwitchDataSchema.safeParse(e.data);
      if (change.success) {
        currentAgentTurn = null;
        const withIcon = (endpoint: ProviderSwitchData['from']) => ({
          ...endpoint,
          providerIcon: endpoint.providerIcon || providerIcons?.get(endpoint.providerId),
        });
        result.push({
          type: 'provider_switch',
          event: e,
          change: {
            ...change.data,
            from: withIcon(change.data.from),
            to: withIcon(change.data.to),
          },
          isStreaming: false,
        });
      }
      continue;
    }

    if (
      e.type === 'status' &&
      (statusVal === 'runtime_error' ||
        statusVal === 'operation_failed' ||
        statusVal === 'prompt_failed') &&
      failureOwners.has(ownerOf(e, userId)) &&
      failureOwners.get(ownerOf(e, userId)) !== e.id
    )
      continue;

    if (
      e.type === 'status' &&
      (statusVal === 'prompt_failed' || statusVal === 'operation_failed')
    ) {
      currentAgentTurn = null;
      result.push({ type: 'error', event: e, isStreaming: false });
      continue;
    }

    if (e.type === 'status' && (statusVal === 'model_fallback' || statusVal === 'runtime_error')) {
      currentAgentTurn = null;
      result.push({ type: 'notice', event: e, isStreaming: false });
      continue;
    }

    if (e.type === 'status' && statusVal === 'turn_end') {
      if (currentAgentTurn) {
        currentAgentTurn.events.push(e);
        if (isStreaming) currentAgentTurn.isStreaming = true;
      }
      continue;
    }

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

    if (e.type === 'status') {
      if (currentAgentTurn) {
        currentAgentTurn.events.push(e);
        if (isStreaming) currentAgentTurn.isStreaming = true;
      }
      continue;
    }

    const isUser = isSessionEventText(e) && e.data.role === 'user' && !e.metadata?.nativeSessionId;

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
