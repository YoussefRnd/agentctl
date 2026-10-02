import { invalidateWorkspaceQueries } from '@/shared/lib/workspaceQueries';
import { createContext, use, useMemo, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { SessionEventRow, SessionWithCapabilities, SessionMode } from '@agentctl/shared';
import { api } from '@agentctl/api-client';
import { sessionKeys } from '@/shared/lib/queryKeys';
import { useSessionConfigState } from './useSessionConfigState';
import { useWorkspaceReviewState, type ReviewResponse } from './useWorkspaceReviewState';
import { useSessionEvents } from './useSessionEvents';
import { sendDesktopNotification } from '@/shared/lib/notifications';

interface PlanItem {
  text: string;
  completed: boolean;
}

export interface StructuredPlanItem {
  name: string;
  status: 'pending' | 'in_progress' | 'completed';
  isCompleted: boolean;
  priority?: 'high' | 'medium' | 'low';
}

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

const fetchSession = async (sessionId: string): Promise<SessionWithCapabilities> => {
  const res = await api.getSessionById({ params: { id: sessionId } });
  if (res.status !== 200) {
    throw new Error(`Failed to fetch session: ${String(res.status)}`);
  }
  return res.body;
};

export function SessionConfigProvider({
  sessionId,
  children,
}: {
  sessionId: string;
  children: ReactNode;
}) {
  const { data: sessionData = null, isLoading: isLoadingSession } = useQuery({
    queryKey: sessionKeys.detail(sessionId),
    queryFn: () => fetchSession(sessionId),
    enabled: !!sessionId,
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
import { sendSessionInput, updateOptimisticDelivery } from './messageDelivery';
export type { QueuedMessage };
const EMPTY_QUEUED_MESSAGES: QueuedMessage[] = [];

interface SessionStreamContextValue {
  events: SessionEventRow[];
  isLoadingEvents: boolean;
  isConnected: boolean;
  streamingEventId: number | null;
  hasMoreHistory: boolean;
  loadOlderHistory: () => Promise<void>;
  isLoadingOlderHistory: boolean;
  historyError: string | null;
  planItems: PlanItem[];
  structuredPlan: StructuredPlanItem[];
  queuedMessages: QueuedMessage[];
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
    isLoading: isLoadingEvents,
    isConnected,
    streamingEventId,
    hasMore: hasMoreHistory,
    loadOlder: loadOlderHistory,
    isLoadingOlder: isLoadingOlderHistory,
    historyError,
  } = useSessionEvents(sessionId);

  const queuedMessages = useMessageQueueStore(
    (s) => s.queuedMessages[sessionId] ?? EMPTY_QUEUED_MESSAGES,
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
    (id: string) => dequeueQueuedMessage(sessionId, id),
    [dequeueQueuedMessage, sessionId],
  );
  const reorderQueuedMessages = useCallback(
    (newQueue: QueuedMessage[]) => reorderQueuedMessagesForSession(sessionId, newQueue),
    [reorderQueuedMessagesForSession, sessionId],
  );
  const moveQueuedMessage = useCallback(
    (index: number, direction: 'up' | 'down') =>
      moveQueuedMessageForSession(sessionId, index, direction),
    [moveQueuedMessageForSession, sessionId],
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
    queryKey: sessionKeys.detail(sessionId),
    queryFn: () => fetchSession(sessionId),
    enabled: !!sessionId,
  });

  const retryQueuedMessage = useCallback(
    (id: string) => {
      const message = useMessageQueueStore
        .getState()
        .queuedMessages[sessionId]?.find((candidate) => candidate.id === id);
      if (!message || message.status === 'sending') return;
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
    [sessionId, queryClient, enqueueMessage, retryQueuedMessage],
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
    if (nextMessage.status === 'failed' || nextMessage.status === 'sending') return;
    awaitingQueuedTurnRef.current = true;
    queuedTurnStartEventIdRef.current = latestEventId;
    const setDelivery = (status: 'queued' | 'sending' | 'accepted' | 'failed', error?: string) => {
      if (nextMessage.optimisticEventId !== undefined) {
        updateOptimisticDelivery(
          queryClient,
          sessionId,
          nextMessage.optimisticEventId,
          status,
          error,
        );
      }
    };
    const markFailed = (error: unknown) => {
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
    queueMicrotask(() => {
      useMessageQueueStore.getState().setMessageStatus(sessionId, nextMessage.id, 'sending');
      setDelivery('sending');
      void sendSessionInput(sessionId, nextMessage.text, nextMessage.attachmentIds, nextMessage.id)
        .then((eventId) => {
          if (currentSessionRef.current === sessionId) queuedTurnStartEventIdRef.current = eventId;
          dequeueMessage(nextMessage.id);
          setDelivery('accepted');
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
      isLoadingEvents,
      isConnected,
      streamingEventId,
      hasMoreHistory,
      loadOlderHistory,
      isLoadingOlderHistory,
      historyError,
      planItems,
      structuredPlan,
      queuedMessages,
      enqueueMessage,
      dequeueMessage,
      retryMessage,
      retryQueuedMessage,
      reorderQueuedMessages,
      moveQueuedMessage,
    }),
    [
      events,
      isLoadingEvents,
      isConnected,
      streamingEventId,
      hasMoreHistory,
      loadOlderHistory,
      isLoadingOlderHistory,
      historyError,
      planItems,
      structuredPlan,
      queuedMessages,
      enqueueMessage,
      dequeueMessage,
      retryMessage,
      retryQueuedMessage,
      reorderQueuedMessages,
      moveQueuedMessage,
    ],
  );

  return <SessionStreamContext.Provider value={value}>{children}</SessionStreamContext.Provider>;
}

export function useSessionStream() {
  const context = use(SessionStreamContext);
  if (!context) {
    throw new Error('useSessionStream must be used within a SessionStreamProvider');
  }
  return context;
}
