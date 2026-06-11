import { createContext, useContext, useMemo, useCallback, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ACPEventRow, SessionWithCapabilities, SessionMode } from '@agentctl/shared';
import { sessionStore } from '@agentctl/shared';
import {
  apiClient,
  stageReviewFile,
  revertReviewFile,
  switchSessionMode,
  mergeSession,
  discardSession,
  setApprovalMode,
} from '@agentctl/api-client';
import { useSessionEvents } from '../hooks/useSessionEvents';
import type { ReviewFile } from '../features/session/components/ReviewView';

interface ReviewResponse {
  files: ReviewFile[];
}

interface PlanItem {
  text: string;
  completed: boolean;
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
  updateProvider: (providerId: string, modelId?: string) => Promise<void>;
  isUpdatingProvider: boolean;
}

const SessionConfigContext = createContext<SessionConfigContextValue | null>(null);

const fetchSession = async (sessionId: string): Promise<SessionWithCapabilities> => {
  return apiClient.fetch<SessionWithCapabilities>(`/api/sessions/${sessionId}`);
};

const fetchReview = async (sessionId: string): Promise<ReviewResponse> => {
  return apiClient.fetch<ReviewResponse>(`/api/sessions/${sessionId}/review`);
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

  const {
    data: reviewData = { files: [] },
    isLoading: isLoadingReview,
    refetch: refetchReview,
  } = useQuery({
    queryKey: ['session-review', sessionId],
    queryFn: () => fetchReview(sessionId),
    enabled: !!sessionId,
  });

  const queryClient = useQueryClient();

  const { data: branches = [] } = useQuery({
    queryKey: ['session-branches', sessionId],
    queryFn: () => apiClient.fetch<string[]>(`/api/sessions/${sessionId}/branches`),
    enabled: !!sessionId,
  });

  const updateProviderMutation = useMutation({
    mutationFn: ({ providerId, modelId }: { providerId: string; modelId?: string }) =>
      apiClient.fetch(`/api/sessions/${sessionId}/provider`, {
        method: 'PATCH',
        body: JSON.stringify({ providerId, modelId }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
    },
  });

  const updateProvider = useCallback(
    async (providerId: string, modelId?: string) => {
      await updateProviderMutation.mutateAsync({ providerId, modelId });
    },
    [updateProviderMutation],
  );

  const switchBranchMutation = useMutation({
    mutationFn: (branch: string) =>
      apiClient.fetch(`/api/sessions/${sessionId}/branch`, {
        method: 'POST',
        body: JSON.stringify({ branch }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
      void queryClient.invalidateQueries({ queryKey: ['session-branches', sessionId] });
    },
  });

  const switchBranch = useCallback(
    async (branch: string) => {
      await switchBranchMutation.mutateAsync(branch);
    },
    [switchBranchMutation],
  );

  const switchModeMutation = useMutation({
    mutationFn: (mode: SessionMode) => switchSessionMode(sessionId, mode),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
    },
  });

  const switchMode = useCallback(
    async (mode: SessionMode) => {
      await switchModeMutation.mutateAsync(mode);
    },
    [switchModeMutation],
  );

  const stageMutation = useMutation({
    mutationFn: (filePath: string) => stageReviewFile(sessionId, filePath),
    onSuccess: () => {
      void refetchReview();
    },
  });

  const revertMutation = useMutation({
    mutationFn: (filePath: string) => revertReviewFile(sessionId, filePath),
    onSuccess: () => {
      void refetchReview();
    },
  });

  const stageFile = useCallback(
    async (filePath: string) => {
      await stageMutation.mutateAsync(filePath);
    },
    [stageMutation],
  );

  const revertFile = useCallback(
    async (filePath: string) => {
      await revertMutation.mutateAsync(filePath);
    },
    [revertMutation],
  );

  const mergeMutation = useMutation({
    mutationFn: (commitMessage?: string) => mergeSession(sessionId, commitMessage),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
      void refetchReview();
    },
  });

  const mergeSessionFn = useCallback(
    async (commitMessage?: string) => {
      await mergeMutation.mutateAsync(commitMessage);
    },
    [mergeMutation],
  );

  const discardMutation = useMutation({
    mutationFn: () => discardSession(sessionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
      void refetchReview();
    },
  });

  const discardSessionFn = useCallback(
    async () => {
      await discardMutation.mutateAsync();
    },
    [discardMutation],
  );

  const setApprovalModeMutation = useMutation({
    mutationFn: (approvalMode: 'review' | 'auto_approve' | 'yolo') => setApprovalMode(sessionId, approvalMode),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
    },
  });

  const handleSetApprovalMode = useCallback(
    async (approvalMode: 'review' | 'auto_approve' | 'yolo') => {
      await setApprovalModeMutation.mutateAsync(approvalMode);
    },
    [setApprovalModeMutation],
  );

  const value = useMemo(
    () => ({
      sessionId,
      isLoadingSession,
      reviewData,
      isLoadingReview,
      stageFile,
      revertFile,
      refetchReview,
      branches,
      switchBranch,
      isSwitchingBranch: switchBranchMutation.isPending,
      switchMode,
      isSwitchingMode: switchModeMutation.isPending,
      mergeSession: mergeSessionFn,
      isMergingSession: mergeMutation.isPending,
      discardSession: discardSessionFn,
      isDiscardingSession: discardMutation.isPending,
      setApprovalMode: handleSetApprovalMode,
      isUpdatingApprovalMode: setApprovalModeMutation.isPending,
      updateProvider,
      isUpdatingProvider: updateProviderMutation.isPending,
    }),
    [
      sessionId,
      isLoadingSession,
      reviewData,
      isLoadingReview,
      stageFile,
      revertFile,
      refetchReview,
      branches,
      switchBranch,
      switchBranchMutation.isPending,
      switchMode,
      switchModeMutation.isPending,
      mergeSessionFn,
      mergeMutation.isPending,
      discardSessionFn,
      discardMutation.isPending,
      handleSetApprovalMode,
      setApprovalModeMutation.isPending,
      updateProvider,
      updateProviderMutation.isPending,
    ],
  );

  return <SessionConfigContext.Provider value={value}>{children}</SessionConfigContext.Provider>;
}

export function useSession() {
  const context = useContext(SessionConfigContext);
  if (!context) {
    throw new Error('useSession must be used within a SessionConfigProvider');
  }

  const sessionState = useSyncExternalStore(
    (listener) => sessionStore.subscribe(listener),
    () => sessionStore.getState(),
  );

  const capabilities = useMemo(() => sessionStore.resolveCapabilities(), [sessionState.currentSession]);

  return useMemo(
    () => ({
      ...context,
      sessionData: sessionState.currentSession,
      isLoadingSession: context.isLoadingSession,
      capabilities,
    }),
    [context, sessionState.currentSession, capabilities],
  );
}

// ==========================================
// 2. SESSION STREAM CONTEXT
// ==========================================
interface SessionStreamContextValue {
  events: ACPEventRow[];
  isLoadingEvents: boolean;
  isConnected: boolean;
  streamingEventId: number | null;
  sendMessage: (payload: unknown) => void;
  planItems: PlanItem[];
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
    sendMessage,
    isConnected,
    streamingEventId,
  } = useSessionEvents(sessionId);

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
          const completed = trimmed.includes('[x]');
          planMap.set(text, completed);
        }
      }
    }

    return Array.from(planMap.entries()).map(([text, completed]) => ({
      text,
      completed,
    }));
  }, [events]);

  const value = useMemo(
    () => ({
      events,
      isLoadingEvents,
      isConnected,
      streamingEventId,
      sendMessage,
      planItems,
    }),
    [events, isLoadingEvents, isConnected, streamingEventId, sendMessage, planItems],
  );

  return <SessionStreamContext.Provider value={value}>{children}</SessionStreamContext.Provider>;
}

export function useSessionStream() {
  const context = useContext(SessionStreamContext);
  if (!context) {
    throw new Error('useSessionStream must be used within a SessionStreamProvider');
  }
  return context;
}
