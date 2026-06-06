import { createContext, useContext, useMemo, useCallback, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ACPEventRow, SessionWithCapabilities, SessionMode } from '@agentctl/shared';
import {
  apiClient,
  stageReviewFile,
  revertReviewFile,
  switchSessionMode,
  mergeSession,
  discardSession,
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

interface SessionContextValue {
  sessionId: string;
  sessionData: SessionWithCapabilities | null;
  isLoadingSession: boolean;
  events: ACPEventRow[];
  isLoadingEvents: boolean;
  isConnected: boolean;
  streamingEventId: number | null;
  sendMessage: (payload: unknown) => void;
  reviewData: ReviewResponse;
  isLoadingReview: boolean;
  planItems: PlanItem[];
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
}

const SessionContext = createContext<SessionContextValue | null>(null);

const fetchSession = async (sessionId: string): Promise<SessionWithCapabilities> => {
  return apiClient.fetch<SessionWithCapabilities>(`/api/sessions/${sessionId}`);
};

const fetchReview = async (sessionId: string): Promise<ReviewResponse> => {
  return apiClient.fetch<ReviewResponse>(`/api/sessions/${sessionId}/review`);
};

export function SessionProvider({
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

  const { data: sessionData = null, isLoading: isLoadingSession } = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => fetchSession(sessionId),
    enabled: !!sessionId,
  });

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

  const planItems = useMemo(() => {
    const planMap = new Map<string, boolean>();

    // Single pass over events
    for (const e of events) {
      if (e.type !== 'text') continue;

      const content = e.data.content;
      if (!content.includes('- [')) continue; // Quick skip

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
      sessionId,
      sessionData,
      isLoadingSession,
      events,
      isLoadingEvents,
      isConnected,
      streamingEventId,
      sendMessage,
      reviewData,
      isLoadingReview,
      planItems,
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
    }),
    [
      sessionId,
      sessionData,
      isLoadingSession,
      events,
      isLoadingEvents,
      isConnected,
      streamingEventId,
      sendMessage,
      reviewData,
      isLoadingReview,
      planItems,
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
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return context;
}
