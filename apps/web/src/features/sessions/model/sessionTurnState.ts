import {
  providerRetryStatusSchema,
  type ProviderRetryStatus,
  type SessionEventRow,
  type SessionExecution,
} from '@agentctl/shared';

export type SessionTurnPhase =
  'sending' | 'queued' | 'starting' | 'waiting' | 'active' | 'approval' | 'retrying';
export interface SessionTurnState {
  phase: SessionTurnPhase;
  startedAt: Date;
  canCancel: boolean;
  retry?: ProviderRetryStatus;
}

/** Delivery and execution remain visible while a provider connection is being established. */
export function getSessionTurnState(
  events: SessionEventRow[],
  sessionStatus?: string,
  execution?: SessionExecution,
): SessionTurnState | null {
  if (['error', 'archived', 'merged', 'discarded'].includes(sessionStatus ?? '')) return null;
  let userIndex = -1;
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    if (event.type === 'text' && event.data.role === 'user' && !event.metadata?.nativeSessionId) {
      userIndex = index;
      break;
    }
  }
  if (userIndex < 0) return null;
  // An accepted queued message must not replace the active turn's progress.
  if (execution?.attemptId && ['running', 'waiting'].includes(execution.execution)) {
    const activeIndex = events.findIndex(
      (event) =>
        event.type === 'text' &&
        event.data.role === 'user' &&
        event.metadata?.attemptId === execution.attemptId,
    );
    if (activeIndex >= 0) userIndex = activeIndex;
  }
  const user = events[userIndex];
  if (user.type !== 'text') return null;
  const delivery = user.data.deliveryStatus;
  if (['failed', 'unknown', 'cancelled'].includes(delivery ?? '')) return null;
  const matchesAttempt = !!execution?.attemptId && user.metadata?.attemptId === execution.attemptId;
  if (
    matchesAttempt &&
    ['completed', 'failed', 'cancelled', 'interrupted', 'unknown'].includes(execution!.execution)
  )
    return null;
  if (
    !delivery &&
    sessionStatus !== 'running' &&
    sessionStatus !== 'needs_attention' &&
    !(matchesAttempt && ['running', 'waiting'].includes(execution!.execution))
  )
    return null;
  const updates = events.slice(userIndex + 1);
  if (
    updates.some(
      (event) =>
        event.type === 'status' &&
        typeof event.data.status === 'string' &&
        ['turn_end', 'prompt_failed'].includes(event.data.status),
    )
  )
    return null;
  let phase: SessionTurnPhase;
  let retry: ProviderRetryStatus | undefined;
  for (const event of updates) {
    if (
      event.metadata?.nativeSessionId ||
      event.type !== 'status' ||
      event.data.status !== 'session_info_update'
    )
      continue;
    if (event.data.retry === null) retry = undefined;
    else if (event.data.retry !== undefined) {
      const parsed = providerRetryStatusSchema.safeParse(event.data.retry);
      if (parsed.success) retry = parsed.data;
    }
  }
  if (sessionStatus === 'needs_attention' || execution?.attention === 'approval')
    phase = 'approval';
  else if (retry) phase = 'retrying';
  else if (
    updates.some(
      (event) =>
        event.type === 'tool_call' ||
        event.type === 'subagent_update' ||
        (event.type === 'text' && event.data.role !== 'user'),
    )
  )
    phase = 'active';
  else if (delivery === 'sending') phase = 'sending';
  else if (delivery === 'queued') phase = 'queued';
  else if (delivery === 'accepted' || sessionStatus === 'running')
    phase =
      sessionStatus === 'running' || execution?.connection === 'connected' ? 'waiting' : 'starting';
  else return null;
  return {
    phase,
    startedAt: new Date(user.createdAt),
    canCancel: ['waiting', 'active', 'approval', 'retrying'].includes(phase),
    ...(retry ? { retry } : {}),
  };
}
