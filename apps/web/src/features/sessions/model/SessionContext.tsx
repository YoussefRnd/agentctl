import { createContext, use, useMemo, useEffect, useRef, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { SessionEventRow, SessionWithCapabilities, SessionMode } from '@agentctl/shared';
import { api } from '@agentctl/api-client';
import { sessionKeys } from '@/shared/lib/queryKeys';
import { useSessionConfigState } from './useSessionConfigState';
import { useWorkspaceReviewState } from './useWorkspaceReviewState';
import { useSessionEvents } from './useSessionEvents';
import { sendDesktopNotification } from '@/shared/lib/notifications';
import type { ReviewFile } from '@/features/review';

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
export type { QueuedMessage };

interface SessionStreamContextValue {
  events: SessionEventRow[];
  isLoadingEvents: boolean;
  isConnected: boolean;
  streamingEventId: number | null;
  planItems: PlanItem[];
  structuredPlan: StructuredPlanItem[];
  queuedMessages: QueuedMessage[];
  enqueueMessage: (text: string, attachmentIds?: string[]) => void;
  dequeueMessage: (id: string) => void;
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
  } = useSessionEvents(sessionId);

  const queuedMessages = useMessageQueueStore((s) => s.queuedMessages);
  const enqueueMessage = useMessageQueueStore((s) => s.enqueueMessage);
  const dequeueMessage = useMessageQueueStore((s) => s.dequeueMessage);
  const reorderQueuedMessages = useMessageQueueStore((s) => s.reorderQueuedMessages);
  const moveQueuedMessage = useMessageQueueStore((s) => s.moveQueuedMessage);

  const { data: sessionData } = useQuery({
    queryKey: sessionKeys.detail(sessionId),
    queryFn: () => fetchSession(sessionId),
    enabled: !!sessionId,
  });

  useEffect(() => {
    const isIdle = sessionData?.session.status === 'idle';
    if (isIdle && queuedMessages.length > 0) {
      const nextMessage = queuedMessages[0];
      queueMicrotask(() => {
        dequeueMessage(nextMessage.id);
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
            const errorMessage = err instanceof Error ? err.message : String(err);
            toast.error('Failed to send queued message', {
              description: errorMessage,
              action: {
                label: 'Re-send',
                onClick: () => {
                  enqueueMessage(nextMessage.text, nextMessage.attachmentIds);
                },
              },
            });
            const cleaned = (
              queryClient.getQueryData<SessionEventRow[]>(sessionKeys.events(sessionId)) ?? []
            ).filter(
              (e) =>
                !(
                  e.id < 0 &&
                  e.type === 'text' &&
                  (e.data as { role?: string }).role === 'user' &&
                  (e.data as { content?: string }).content === nextMessage.text
                ),
            );
            queryClient.setQueryData<SessionEventRow[]>(sessionKeys.events(sessionId), cleaned);
          });
      });
    }
  }, [
    sessionData?.session.status,
    queuedMessages,
    sessionId,
    queryClient,
    dequeueMessage,
    enqueueMessage,
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
      void queryClient.invalidateQueries({ queryKey: sessionKeys.review(sessionId) });
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
      planItems,
      structuredPlan,
      queuedMessages,
      enqueueMessage,
      dequeueMessage,
      reorderQueuedMessages,
      moveQueuedMessage,
    }),
    [
      events,
      isLoadingEvents,
      isConnected,
      streamingEventId,
      planItems,
      structuredPlan,
      queuedMessages,
      enqueueMessage,
      dequeueMessage,
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
