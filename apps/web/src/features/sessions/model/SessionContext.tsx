import { useAcceptedMessageQueue } from './useAcceptedMessageQueue';
import { invalidateWorkspaceQueries } from '@/shared/lib/workspaceQueries';
import {
  createContext,
  use,
  useMemo,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
  type ReactNode,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  PlanItem as AgentPlanItem,
  SessionEventRow,
  SessionWithCapabilities,
  SessionMode,
} from '@agentctl/shared';
import { sessionDetailOptions } from '../api/sessionNavigation';
import { sessionKeys } from '@/shared/lib/queryKeys';
import { useSessionConfigState } from './useSessionConfigState';
import { useWorkspaceReviewState, type ReviewResponse } from './useWorkspaceReviewState';
import { useSessionEvents } from './useSessionEvents';
import { getSessionTurnState, type SessionTurnState } from './sessionTurnState';
import { sendDesktopNotification } from '@/shared/lib/notifications';

interface PlanItem {
  text: string;
  completed: boolean;
}

export type StructuredPlanItem = AgentPlanItem;

// ==========================================
// 1. SESSION CONFIG CONTEXT
// ==========================================
interface SessionConfigContextValue {
  sessionId: string;
  sessionData: SessionWithCapabilities | null;
  capabilities: SessionWithCapabilities['capabilities'];
  isLoadingSession: boolean;
  reviewData: ReviewResponse;
  isLoadingReview: boolean;
  stageFile: (filePath: string) => Promise<void>;
  revertFile: (filePath: string) => Promise<void>;
  unstageFile: (filePath: string) => Promise<void>;
  stageAll: () => Promise<void>;
  unstageAll: () => Promise<void>;
  commitChanges: (message: string, includeUnstaged?: boolean) => Promise<void>;
  pushChanges: () => Promise<{ success: boolean; output: string }>;
  pullChanges: () => Promise<{ success: boolean; output: string }>;
  mergeBranch: (branch: string) => Promise<void>;
  isMergingBranch: boolean;
  isPushing: boolean;
  isPulling: boolean;
  isCommitting: boolean;
  isStagingAll: boolean;
  isUnstagingAll: boolean;
  refetchReview: () => void;
  branches: string[];
  switchBranch: (branch: string) => Promise<void>;
  isSwitchingBranch: boolean;
  switchMode: (mode: SessionMode) => Promise<void>;
  isSwitchingMode: boolean;
  mergeSession: (commitMessage?: string) => Promise<void>;
  isMergingSession: boolean;
  discardSession: () => Promise<void>;
  isDiscardingSession: boolean;
  setApprovalMode: (approvalMode: 'review' | 'auto_approve' | 'yolo') => Promise<void>;
  isUpdatingApprovalMode: boolean;
  setAgentPersona: (persona: string) => Promise<void>;
  isUpdatingAgentPersona: boolean;
  updateProvider: (providerId: string, modelId?: string) => Promise<void>;
  isUpdatingProvider: boolean;
  setSessionConfigOption: (configId: string, value: string) => Promise<void>;
  isUpdatingConfigOption: boolean;
}

const SessionConfigContext = createContext<SessionConfigContextValue | null>(null);

export function SessionConfigProvider({
  sessionId,
  children,
}: {
  sessionId: string;
  children: ReactNode;
}) {
  const { data: sessionData = null, isLoading: isLoadingSession } = useQuery({
    ...sessionDetailOptions(sessionId),
  });

  const configState = useSessionConfigState(sessionId);
  const reviewState = useWorkspaceReviewState(sessionId);

  const value = useMemo(
    () => ({
      sessionId,
      sessionData,
      isLoadingSession,
      capabilities: sessionData?.capabilities ?? [],
      ...configState,
      ...reviewState,
    }),
    [sessionId, sessionData, isLoadingSession, configState, reviewState],
  );

  return <SessionConfigContext.Provider value={value}>{children}</SessionConfigContext.Provider>;
}

export function useSession() {
  const context = use(SessionConfigContext);
  if (!context) {
    throw new Error('useSession must be used within a SessionConfigProvider');
  }
  return context;
}

// ==========================================
// 2. SESSION STREAM CONTEXT
// ==========================================
import { useMessageQueueStore, type QueuedMessage } from '@/shared';
import {
  acknowledgeSessionInput,
  sendSessionInput,
  updateOptimisticDelivery,
} from './messageDelivery';
export type { QueuedMessage };
const EMPTY_QUEUED_MESSAGES: QueuedMessage[] = [];

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
  const queryClient = useQueryClient();
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

  const acceptedQueue = useAcceptedMessageQueue(sessionId);
  const queuedMessages = useMessageQueueStore(
    (s) => s.queuedMessages[sessionId] ?? EMPTY_QUEUED_MESSAGES,
  );
  const displayQueue = useMemo(
    () => [
      ...acceptedQueue.queuedMessages,
      ...queuedMessages.filter(
        (message) => !acceptedQueue.queuedMessages.some((accepted) => accepted.id === message.id),
      ),
    ],
    [acceptedQueue.queuedMessages, queuedMessages],
  );
  const enqueueQueuedMessage = useMessageQueueStore((s) => s.enqueueMessage);
  const dequeueQueuedMessage = useMessageQueueStore((s) => s.dequeueMessage);
  const reorderQueuedMessagesForSession = useMessageQueueStore((s) => s.reorderQueuedMessages);
  const moveQueuedMessageForSession = useMessageQueueStore((s) => s.moveQueuedMessage);
  const enqueueMessage = useCallback(
    (text: string, attachmentIds?: string[], optimisticEventId?: number, id?: string) =>
      enqueueQueuedMessage(sessionId, text, attachmentIds, optimisticEventId, id),
    [enqueueQueuedMessage, sessionId],
  );
  const dequeueMessage = useCallback(
    (id: string) => {
      if (
        acceptedQueue.queuedMessages.some((message) => message.id === id) ||
        queryClient
          .getQueryData<SessionEventRow[]>(sessionKeys.events(sessionId))
          ?.some(
            (event) => event.id > 0 && event.type === 'text' && event.data.clientMessageId === id,
          )
      )
        void acceptedQueue.changeMessage(id, 'cancel');
      else {
        const message = useMessageQueueStore
          .getState()
          .queuedMessages[sessionId]?.find((item) => item.id === id);
        if (!message || message.status === 'sending') return;
        dequeueQueuedMessage(sessionId, id);
        if (message.optimisticEventId !== undefined)
          updateOptimisticDelivery(queryClient, sessionId, message.optimisticEventId, 'cancelled');
      }
    },
    [dequeueQueuedMessage, sessionId, acceptedQueue, queryClient],
  );
  const editQueuedMessage = useCallback(
    async (id: string, text: string) => {
      if (
        acceptedQueue.queuedMessages.some((message) => message.id === id) ||
        queryClient
          .getQueryData<SessionEventRow[]>(sessionKeys.events(sessionId))
          ?.some(
            (event) => event.id > 0 && event.type === 'text' && event.data.clientMessageId === id,
          )
      )
        return acceptedQueue.changeMessage(id, 'edit', text);
      const queue = useMessageQueueStore.getState();
      const message = queue.queuedMessages[sessionId]?.find((item) => item.id === id);
      if (!message || !queue.editMessage(sessionId, id, text)) return false;
      queryClient.setQueryData<SessionEventRow[]>(sessionKeys.events(sessionId), (old = []) =>
        old.map((event) =>
          event.id === message.optimisticEventId && event.type === 'text'
            ? { ...event, data: { ...event.data, content: text.trim() } }
            : event,
        ),
      );
      return true;
    },
    [acceptedQueue, sessionId, queryClient],
  );
  const reorderQueuedMessages = useCallback(
    (newQueue: QueuedMessage[]) => reorderQueuedMessagesForSession(sessionId, newQueue),
    [reorderQueuedMessagesForSession, sessionId],
  );
  const moveQueuedMessage = useCallback(
    (index: number, direction: 'up' | 'down') => {
      const message = displayQueue[index];
      const neighbor = displayQueue[index + (direction === 'up' ? -1 : 1)];
      if (
        !message ||
        !neighbor ||
        !!message.accepted !== !!neighbor.accepted ||
        [message, neighbor].some((item) => item.status === 'sending' || item.status === 'unknown')
      )
        return;
      if (message?.accepted) void acceptedQueue.changeMessage(message.id, direction);
      else
        moveQueuedMessageForSession(
          sessionId,
          queuedMessages.findIndex((item) => item.id === message?.id),
          direction,
        );
    },
    [moveQueuedMessageForSession, sessionId, acceptedQueue, displayQueue, queuedMessages],
  );
  const currentSessionRef = useRef(sessionId);
  currentSessionRef.current = sessionId;
  const awaitingQueuedTurnRef = useRef(false);
  const queuedTurnStartEventIdRef = useRef(0);
  const latestEventId = useMemo(
    () => events.reduce((max, event) => Math.max(max, event.id), 0),
    [events],
  );
  const latestTurnEndId = useMemo(
    () =>
      events.reduce(
        (max, event) =>
          event.type === 'status' && event.data.status === 'turn_end'
            ? Math.max(max, event.id)
            : max,
        0,
      ),
    [events],
  );

  useEffect(() => {
    awaitingQueuedTurnRef.current = false;
    queuedTurnStartEventIdRef.current = 0;
  }, [sessionId]);

  const { data: sessionData } = useQuery({
    ...sessionDetailOptions(sessionId),
  });

  const retryQueuedMessage = useCallback(
    (id: string) => {
      const message = useMessageQueueStore
        .getState()
        .queuedMessages[sessionId]?.find((candidate) => candidate.id === id);
      if (!message || message.status === 'sending' || message.status === 'unknown') return;
      awaitingQueuedTurnRef.current = false;
      useMessageQueueStore.getState().setMessageStatus(sessionId, id, 'queued');
      if (message.optimisticEventId !== undefined)
        updateOptimisticDelivery(queryClient, sessionId, message.optimisticEventId, 'queued');
      queryClient.setQueryData<SessionWithCapabilities>(sessionKeys.detail(sessionId), (old) =>
        old?.session.status === 'error'
          ? { ...old, session: { ...old.session, status: 'idle' } }
          : old,
      );
    },
    [sessionId, queryClient],
  );

  const retryMessage = useCallback(
    (eventId: number) => {
      const message = useMessageQueueStore
        .getState()
        .queuedMessages[sessionId]?.find((candidate) => candidate.optimisticEventId === eventId);
      if (message) {
        retryQueuedMessage(message.id);
        return;
      }
      const event = queryClient
        .getQueryData<SessionEventRow[]>(sessionKeys.events(sessionId))
        ?.find((candidate) => candidate.id === eventId);
      if (
        eventId > 0 &&
        event?.type === 'text' &&
        event.data.deliveryStatus === 'failed' &&
        (!event.data.deliveryFailure ||
          (event.data.deliveryFailure.actions.includes('retry') &&
            ['not_sent', 'rejected'].includes(event.data.deliveryFailure.delivery)))
      ) {
        // A rejected send is a new, explicitly requested attempt, not a replay
        // of its durable receipt. Never offer this path for uncertain delivery.
        void acceptedQueue.resume().then((resumed) => {
          if (resumed) enqueueMessage(event.data.content, event.data.attachmentIds);
        });
        return;
      }
      if (eventId < 0 && event?.type === 'text' && event.data.deliveryStatus === 'failed') {
        const id = enqueueMessage(
          event.data.content,
          event.data.attachmentIds,
          eventId,
          event.data.clientMessageId,
        );
        retryQueuedMessage(id);
      }
    },
    [sessionId, queryClient, enqueueMessage, retryQueuedMessage, acceptedQueue],
  );

  useEffect(() => {
    const isIdle = sessionData?.session.status === 'idle';
    if (isIdle && latestTurnEndId > queuedTurnStartEventIdRef.current) {
      awaitingQueuedTurnRef.current = false;
    }
    if (!isIdle) {
      if (sessionData?.session.status) awaitingQueuedTurnRef.current = false;
      return;
    }
    if (
      !isConnected ||
      isLoadingEvents ||
      awaitingQueuedTurnRef.current ||
      queuedMessages.length === 0
    )
      return;

    const nextMessage = queuedMessages[0];
    if (
      nextMessage.status === 'failed' ||
      nextMessage.status === 'sending' ||
      nextMessage.status === 'unknown'
    )
      return;
    awaitingQueuedTurnRef.current = true;
    queuedTurnStartEventIdRef.current = latestEventId;
    const setDelivery = (status: 'queued' | 'sending' | 'accepted' | 'failed', error?: string) => {
      if (nextMessage.optimisticEventId !== undefined) {
        updateOptimisticDelivery(
          queryClient,
          sessionId,
          nextMessage.optimisticEventId,
          status === 'sending' ? 'queued' : status,
          error,
        );
      }
    };
    const markFailed = (error: unknown) => {
      const accepted = queryClient
        .getQueryData<SessionEventRow[]>(sessionKeys.events(sessionId))
        ?.find(
          (event) =>
            event.id > 0 && event.type === 'text' && event.data.clientMessageId === nextMessage.id,
        );
      if (accepted) {
        if (currentSessionRef.current === sessionId)
          queuedTurnStartEventIdRef.current = accepted.id;
        dequeueQueuedMessage(sessionId, nextMessage.id);
        void queryClient.invalidateQueries({ queryKey: ['session-execution', sessionId] });
        void queryClient.invalidateQueries({ queryKey: sessionKeys.detail(sessionId) });
        return;
      }
      if (currentSessionRef.current === sessionId) {
        awaitingQueuedTurnRef.current = false;
      }
      const message = error instanceof Error ? error.message : String(error);
      useMessageQueueStore
        .getState()
        .setMessageStatus(sessionId, nextMessage.id, 'failed', message);
      setDelivery('failed', message);
      toast.error('Failed to send queued message', {
        description: message,
        action: {
          label: 'Retry',
          onClick: () => retryQueuedMessage(nextMessage.id),
        },
      });
      void queryClient.invalidateQueries({ queryKey: sessionKeys.detail(sessionId) });
    };
    useMessageQueueStore.getState().setMessageStatus(sessionId, nextMessage.id, 'sending');
    setDelivery('sending');
    queueMicrotask(() => {
      void sendSessionInput(sessionId, nextMessage.text, nextMessage.attachmentIds, nextMessage.id)
        .then((eventId) => {
          if (currentSessionRef.current === sessionId) queuedTurnStartEventIdRef.current = eventId;
          dequeueQueuedMessage(sessionId, nextMessage.id);
          acknowledgeSessionInput(
            queryClient,
            sessionId,
            nextMessage.id,
            eventId,
            nextMessage.optimisticEventId,
            'queued',
          );
          void queryClient.invalidateQueries({ queryKey: ['session-execution', sessionId] });
          void queryClient.invalidateQueries({ queryKey: sessionKeys.detail(sessionId) });
        })
        .catch(markFailed);
    });
  }, [
    sessionData?.session.status,
    queuedMessages,
    latestEventId,
    latestTurnEndId,
    sessionId,
    queryClient,
    dequeueMessage,
    dequeueQueuedMessage,
    enqueueMessage,
    retryQueuedMessage,
    isConnected,
    isLoadingEvents,
  ]);

  const prevStatusRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const currentStatus = sessionData?.session.status;
    const prevStatus = prevStatusRef.current;

    if (prevStatus !== undefined && currentStatus && prevStatus !== currentStatus) {
      if (prevStatus === 'running' && currentStatus === 'idle') {
        sendDesktopNotification({
          title: 'AgentCtl · Task Complete',
          body: sessionData?.session.title || 'Task finished successfully',
          sessionId,
          type: 'completion',
        });
      } else if (currentStatus === 'needs_attention') {
        sendDesktopNotification({
          title: 'AgentCtl · Approval Required',
          body: `${sessionData?.session.title || 'Session'} is waiting for your review`,
          sessionId,
          type: 'attention',
        });
      }
    }

    prevStatusRef.current = currentStatus;
  }, [sessionData?.session.status, sessionData?.session.title, sessionId]);

  useEffect(() => {
    if (
      sessionData?.session.status === 'idle' ||
      sessionData?.session.status === 'needs_attention' ||
      sessionData?.session.status === 'running'
    ) {
      invalidateWorkspaceQueries(queryClient, sessionId, 'files');
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
    }
  }, [sessionData?.session.status, sessionId, queryClient]);

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
