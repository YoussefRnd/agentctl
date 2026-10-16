import { createContext, use, useMemo, useLayoutEffect, useRef, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SessionEventRow, PlanItem as StructuredPlanItem } from '@agentctl/shared';
import type { QueuedMessage } from '@/shared';
import { sessionDetailOptions } from '../api/sessionNavigation';
import { useSessionEvents } from './useSessionEvents';
import { getSessionTurnState, type SessionTurnState } from './sessionTurnState';
import { useSessionMessageQueue } from './useSessionMessageQueue';
import { useSessionStatusEffects } from './useSessionStatusEffects';

interface PlanItem {
  text: string;
  completed: boolean;
}

interface SessionStreamContextValue {
  execution?: import('@agentctl/shared').SessionExecution;
  events: SessionEventRow[];
  visibleEvents: SessionEventRow[];
  historyRevision: number;
  isLoadingEvents: boolean;
  isConnected: boolean;
  streamingEventId: number | null;
  hasMoreHistory: boolean;
  hasOlderHistory: boolean;
  hasNewerHistory: boolean;
  loadNewerHistory: () => Promise<void>;
  loadEventHistory: (eventId: number) => Promise<void>;
  retryHistory: () => Promise<void>;
  returnToLatestHistory: () => void;
  isLoadingNewerHistory: boolean;
  loadOlderHistory: () => Promise<void>;
  isLoadingOlderHistory: boolean;
  historyError: string | null;
  planItems: PlanItem[];
  structuredPlan: StructuredPlanItem[];
  queuedMessages: QueuedMessage[];
  queueAttention?: 'none' | 'approval' | 'delivery_uncertain' | 'error';
  resumeQueue?: () => Promise<void | boolean>;
  queuePendingId?: string;
  editQueuedMessage: (id: string, text: string) => Promise<boolean>;
  enqueueMessage: (
    text: string,
    attachmentIds?: string[],
    optimisticEventId?: number,
    id?: string,
  ) => string;
  retryQueuedMessage: (id: string) => void;
  dequeueMessage: (id: string) => void;
  retryMessage: (eventId: number) => void;
  reorderQueuedMessages: (newQueue: QueuedMessage[]) => void;
  moveQueuedMessage: (index: number, direction: 'up' | 'down') => void;
}

const SessionStreamContext = createContext<SessionStreamContextValue | null>(null);
type SessionQueueValue = Pick<
  SessionStreamContextValue,
  | 'queuedMessages'
  | 'queueAttention'
  | 'resumeQueue'
  | 'queuePendingId'
  | 'editQueuedMessage'
  | 'enqueueMessage'
  | 'dequeueMessage'
  | 'retryMessage'
  | 'retryQueuedMessage'
  | 'reorderQueuedMessages'
  | 'moveQueuedMessage'
>;
const SessionQueueContext = createContext<SessionQueueValue | null>(null);
const SessionResponseContext = createContext<{
  execution: SessionStreamContextValue['execution'];
  turn: SessionTurnState | null;
} | null>(null);
const SessionPromptContext = createContext<SessionEventRow[] | null>(null);

export function SessionStreamProvider({
  sessionId,
  children,
}: {
  sessionId: string;
  children: ReactNode;
}) {
  const {
    events,
    visibleEvents,
    historyRevision,
    hasOlder: hasOlderHistory,
    hasNewer: hasNewerHistory,
    loadNewer: loadNewerHistory,
    loadEvent: loadEventHistory,
    retryHistory,
    returnToLatest: returnToLatestHistory,
    isLoadingNewer: isLoadingNewerHistory,
    isLoading: isLoadingEvents,
    isConnected,
    streamingEventId,
    hasMore: hasMoreHistory,
    loadOlder: loadOlderHistory,
    isLoadingOlder: isLoadingOlderHistory,
    historyError,
  } = useSessionEvents(sessionId);

  const { data: sessionData } = useQuery({ ...sessionDetailOptions(sessionId) });
  const {
    acceptedQueue,
    displayQueue,
    enqueueMessage,
    dequeueMessage,
    retryQueuedMessage,
    retryMessage,
    editQueuedMessage,
    reorderQueuedMessages,
    moveQueuedMessage,
  } = useSessionMessageQueue(sessionId, events, sessionData, isConnected, isLoadingEvents);
  useSessionStatusEffects(sessionId, sessionData);

  const planItems = useMemo(() => {
    const planMap = new Map<string, boolean>();

    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.type === 'text' && typeof e.data?.content === 'string') {
        const content = e.data.content;
        if (content.includes('- [')) {
          const lines = content.split('\n');
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('- [ ]') || trimmed.startsWith('- [x]')) {
              const text = trimmed.replace(/- \[[ x]\]/, '').trim();
              const completed = trimmed.startsWith('- [x]');
              if (!planMap.has(text)) {
                planMap.set(text, completed);
              }
            }
          }
        }
      }
      // Stop scanning once we reach the latest user message boundary
      if (e.type === 'text' && e.data?.role === 'user') {
        break;
      }
    }

    return Array.from(planMap.entries()).map(([text, completed]) => ({
      text,
      completed,
    }));
  }, [events]);

  const structuredPlan = useMemo(() => {
    // Search backwards for the latest plan_update in the session
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.type === 'plan_update') {
        const data = e.data as { plan: StructuredPlanItem[] };
        return data.plan ?? [];
      }
    }
    return [];
  }, [events]);

  const value = useMemo(
    () => ({
      events,
      visibleEvents,
      historyRevision,
      hasOlderHistory,
      hasNewerHistory,
      loadNewerHistory,
      loadEventHistory,
      retryHistory,
      returnToLatestHistory,
      isLoadingNewerHistory,
      isLoadingEvents,
      isConnected,
      streamingEventId,
      hasMoreHistory,
      loadOlderHistory,
      isLoadingOlderHistory,
      historyError,
      planItems,
      structuredPlan,
      queuedMessages: displayQueue,
      execution: acceptedQueue.execution,
      queueAttention: acceptedQueue.execution?.attention,
      resumeQueue: acceptedQueue.resume,
      queuePendingId: acceptedQueue.pendingId,
      editQueuedMessage,
      enqueueMessage,
      dequeueMessage,
      retryMessage,
      retryQueuedMessage,
      reorderQueuedMessages,
      moveQueuedMessage,
    }),
    [
      events,
      visibleEvents,
      historyRevision,
      hasOlderHistory,
      hasNewerHistory,
      loadNewerHistory,
      loadEventHistory,
      retryHistory,
      returnToLatestHistory,
      isLoadingNewerHistory,
      isLoadingEvents,
      isConnected,
      streamingEventId,
      hasMoreHistory,
      loadOlderHistory,
      isLoadingOlderHistory,
      historyError,
      planItems,
      structuredPlan,
      displayQueue,
      acceptedQueue.execution,
      acceptedQueue.resume,
      acceptedQueue.pendingId,
      editQueuedMessage,
      enqueueMessage,
      dequeueMessage,
      retryMessage,
      retryQueuedMessage,
      reorderQueuedMessages,
      moveQueuedMessage,
    ],
  );

  // Derive progress once per update. Text content alone cannot change these
  // fields, so historical cards and progress consumers retain their context.
  const previousTurn = useRef<SessionTurnState | null>(null);
  const turn = useMemo(() => {
    const next = getSessionTurnState(events, sessionData?.session.status, acceptedQueue.execution);
    const previous = previousTurn.current;
    if (
      next &&
      previous &&
      next.phase === previous.phase &&
      next.canCancel === previous.canCancel &&
      next.startedAt.getTime() === previous.startedAt.getTime() &&
      next.retry?.attempt === previous.retry?.attempt &&
      next.retry?.nextRetryAt === previous.retry?.nextRetryAt &&
      next.retry?.message === previous.retry?.message &&
      next.retry?.httpStatus === previous.retry?.httpStatus
    )
      return previous;
    return next;
  }, [events, sessionData?.session.status, acceptedQueue.execution]);
  useLayoutEffect(() => {
    previousTurn.current = turn;
  }, [turn]);
  const responseValue = useMemo(
    () => ({ execution: acceptedQueue.execution, turn }),
    [acceptedQueue.execution, turn],
  );
  const queueValue = useMemo<SessionQueueValue>(
    () => ({
      queuedMessages: displayQueue,
      queueAttention: acceptedQueue.execution?.attention,
      resumeQueue: acceptedQueue.resume,
      queuePendingId: acceptedQueue.pendingId,
      editQueuedMessage,
      enqueueMessage,
      dequeueMessage,
      retryMessage,
      retryQueuedMessage,
      reorderQueuedMessages,
      moveQueuedMessage,
    }),
    [
      displayQueue,
      acceptedQueue.execution?.attention,
      acceptedQueue.resume,
      acceptedQueue.pendingId,
      editQueuedMessage,
      enqueueMessage,
      dequeueMessage,
      retryMessage,
      retryQueuedMessage,
      reorderQueuedMessages,
      moveQueuedMessage,
    ],
  );
  const previousPrompts = useRef<SessionEventRow[]>([]);
  const prompts = useMemo(() => {
    const next = events.filter((event) => event.type === 'text' && event.data.role === 'user');
    const previous = previousPrompts.current;
    return next.length === previous.length &&
      next.every((event, index) => event === previous[index])
      ? previous
      : next;
  }, [events]);
  useLayoutEffect(() => {
    previousPrompts.current = prompts;
  }, [prompts]);

  return (
    <SessionStreamContext.Provider value={value}>
      <SessionQueueContext.Provider value={queueValue}>
        <SessionResponseContext.Provider value={responseValue}>
          <SessionPromptContext.Provider value={prompts}>{children}</SessionPromptContext.Provider>
        </SessionResponseContext.Provider>
      </SessionQueueContext.Provider>
    </SessionStreamContext.Provider>
  );
}

export function useSessionStream() {
  const context = use(SessionStreamContext);
  if (!context) {
    throw new Error('useSessionStream must be used within a SessionStreamProvider');
  }
  return context;
}

export function useSessionQueue() {
  const value = use(SessionQueueContext);
  if (!value) throw new Error('useSessionQueue must be used within a SessionStreamProvider');
  return value;
}
export function useSessionResponseState() {
  const value = use(SessionResponseContext);
  if (!value)
    throw new Error('useSessionResponseState must be used within a SessionStreamProvider');
  return value;
}
export function useSessionExecution() {
  return useSessionResponseState().execution;
}
export function useSessionPromptEvents() {
  const value = use(SessionPromptContext);
  if (!value) throw new Error('useSessionPromptEvents must be used within a SessionStreamProvider');
  return value;
}
