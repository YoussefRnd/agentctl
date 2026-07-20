import {
  createContext,
  use,
  useMemo,
  useEffect,
  useSyncExternalStore,
  useState,
  type ReactNode,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ACPEventRow, SessionWithCapabilities, SessionMode } from '@agentctl/shared';
import { sessionStore } from '@agentctl/shared';
import { api } from '@agentctl/api-client';
import { useSessionConfigState } from '../features/session/hooks/useSessionConfigState';
import { useWorkspaceReviewState } from '../features/session/hooks/useWorkspaceReviewState';
import { useSessionEvents } from '../hooks/useSessionEvents';
import type { ReviewFile } from '../features/session/components/ReviewHeader';

interface ReviewResponse {
  files: ReviewFile[];
}

interface PlanItem {
  text: string;
  completed: boolean;
}

export interface StructuredPlanItem {
  name: string;
  status: 'pending' | 'in_progress' | 'completed';
  isCompleted: boolean;
}

// ==========================================
// 1. SESSION CONFIG CONTEXT
// ==========================================
interface SessionConfigContextValue {
  sessionId: string;
  isLoadingSession: boolean;
  reviewData: ReviewResponse;
  isLoadingReview: boolean;
  stageFile: (filePath: string) => Promise<void>;
  revertFile: (filePath: string) => Promise<void>;
  unstageFile: (filePath: string) => Promise<void>;
  stageAll: () => Promise<void>;
  unstageAll: () => Promise<void>;
  commitChanges: (message: string) => Promise<void>;
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
    queryKey: ['session', sessionId],
    queryFn: () => fetchSession(sessionId),
    enabled: !!sessionId,
  });

  useEffect(() => {
    sessionStore.setSession(sessionData);
  }, [sessionData]);

  useEffect(() => {
    sessionStore.setLoading(isLoadingSession);
  }, [isLoadingSession]);

  const configState = useSessionConfigState(sessionId);
  const reviewState = useWorkspaceReviewState(sessionId);

  const value = useMemo(
    () => ({
      sessionId,
      isLoadingSession,
      ...configState,
      ...reviewState,
    }),
    [sessionId, isLoadingSession, configState, reviewState],
  );

  return <SessionConfigContext.Provider value={value}>{children}</SessionConfigContext.Provider>;
}

export function useSession() {
  const context = use(SessionConfigContext);
  if (!context) {
    throw new Error('useSession must be used within a SessionConfigProvider');
  }

  const sessionState = useSyncExternalStore(
    (listener) => sessionStore.subscribe(listener),
    () => sessionStore.getState(),
  );

  return useMemo(
    () => ({
      ...context,
      sessionData: sessionState.currentSession,
      isLoadingSession: context.isLoadingSession,
      capabilities: sessionState.currentSession?.capabilities ?? [],
    }),
    [context, sessionState.currentSession],
  );
}

// ==========================================
// 2. SESSION STREAM CONTEXT
// ==========================================
export interface QueuedMessage {
  id: string;
  text: string;
  attachmentIds?: string[];
}

interface SessionStreamContextValue {
  events: ACPEventRow[];
  isLoadingEvents: boolean;
  isConnected: boolean;
  streamingEventId: number | null;
  planItems: PlanItem[];
  structuredPlan: StructuredPlanItem[];
  queuedMessages: QueuedMessage[];
  enqueueMessage: (text: string, attachmentIds?: string[]) => void;
  dequeueMessage: (id: string) => void;
}

const SessionStreamContext = createContext<SessionStreamContextValue | null>(null);

export function SessionStreamProvider({
  sessionId,
  children,
}: {
  sessionId: string;
  children: ReactNode;
}) {
  const {
    events,
    isLoading: isLoadingEvents,
    isConnected,
    streamingEventId,
  } = useSessionEvents(sessionId);

  const [queuedMessages, setQueuedMessages] = useState<QueuedMessage[]>([]);

  const enqueueMessage = (text: string, attachmentIds?: string[]) => {
    setQueuedMessages((prev) => [...prev, { id: crypto.randomUUID(), text, attachmentIds }]);
  };

  const dequeueMessage = (id: string) => {
    setQueuedMessages((prev) => prev.filter((msg) => msg.id !== id));
  };

  const sessionState = useSyncExternalStore(
    (listener) => sessionStore.subscribe(listener),
    () => sessionStore.getState(),
  );
  const sessionData = sessionState.currentSession;

  useEffect(() => {
    const isIdle = sessionData?.session.status === 'idle';
    if (isIdle && queuedMessages.length > 0) {
      const nextMessage = queuedMessages[0];
      // Dequeue message synchronously to prevent concurrent re-triggers
      setQueuedMessages((prev) => prev.filter((m) => m.id !== nextMessage.id));
      void api
        .sendInput({
          params: { id: sessionId },
          body: {
            input: nextMessage.text,
            ...(nextMessage.attachmentIds && nextMessage.attachmentIds.length > 0
              ? { attachmentIds: nextMessage.attachmentIds }
              : {}),
          },
        })
        .catch((err: unknown) => {
          // eslint-disable-next-line no-console
          console.error('Failed to send queued message:', err);
        });
    }
  }, [sessionData?.session.status, queuedMessages, sessionId]);

  const planItems = useMemo(() => {
    const planMap = new Map<string, boolean>();

    for (const e of events) {
      if (e.type !== 'text') continue;

      const content = e.data.content;
      if (!content.includes('- [')) continue;

      const lines = content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('- [ ]') || trimmed.startsWith('- [x]')) {
          const text = trimmed.replace(/- \[[ x]\]/, '').trim();
          const completed = trimmed.startsWith('- [x]');
          planMap.set(text, completed);
        }
      }
    }

    return Array.from(planMap.entries()).map(([text, completed]) => ({
      text,
      completed,
    }));
  }, [events]);

  const structuredPlan = useMemo(() => {
    // Search backwards for the latest plan_update
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.type === 'plan_update') {
        const data = e.data as { plan: StructuredPlanItem[] };
        return data.plan;
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
      planItems,
      structuredPlan,
      queuedMessages,
      enqueueMessage,
      dequeueMessage,
    }),
    [
      events,
      isLoadingEvents,
      isConnected,
      streamingEventId,
      planItems,
      structuredPlan,
      queuedMessages,
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
