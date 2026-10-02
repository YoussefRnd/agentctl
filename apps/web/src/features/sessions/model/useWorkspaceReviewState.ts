import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  api,
  assertApiStatus,
  stageReviewFile,
  revertReviewFile,
  unstageReviewFile,
  stageAllReviewFiles,
  unstageAllReviewFiles,
  commitWorkspaceChanges,
  pushWorkspaceChanges,
  pullWorkspaceChanges,
  mergeSessionBranch,
  switchSessionMode,
  mergeSession,
  discardSession,
  patchSession,
} from '@agentctl/api-client';
import { invalidateWorkspaceQueries } from '@/shared/lib/workspaceQueries';
import { sessionKeys } from '@/shared/lib/queryKeys';
import type { ReviewResponse } from '@agentctl/shared';
export type { ReviewResponse } from '@agentctl/shared';

const fetchReview = async (sessionId: string): Promise<ReviewResponse> => {
  const res = await api.getSessionReview({
    params: { id: sessionId },
    query: { includeDiffs: 'false', scope: 'working' },
  });
  assertApiStatus(res, 200, 'Failed to fetch session review');
  return {
    capture: res.body.capture,
    files: res.body.files.map((file) => ({
      ...file,
      diff: file.diff ?? '',
    })),
  };
};

export function useWorkspaceReviewState(sessionId: string) {
  const queryClient = useQueryClient();

  const {
    data: reviewData = { files: [] },
    isLoading: isLoadingReview,
    refetch: refetchReview,
  } = useQuery({
    queryKey: sessionKeys.review(sessionId),
    queryFn: () => fetchReview(sessionId),
    enabled: !!sessionId,
    staleTime: 2000,
    refetchOnWindowFocus: true,
  });

  const { data: branches = [] } = useQuery({
    queryKey: sessionKeys.branches(sessionId),
    queryFn: async () => {
      const res = await api.getSessionBranches({ params: { id: sessionId } });
      assertApiStatus(res, 200, 'Failed to fetch branches');
      return res.body;
    },
    enabled: !!sessionId,
    staleTime: 2_000,
    refetchOnWindowFocus: true,
  });

  const switchBranchMutation = useMutation({
    mutationFn: (branch: string) => patchSession(sessionId, { branch }),
    onSuccess: () => invalidateWorkspaceQueries(queryClient, sessionId, 'session'),
  });

  const switchBranch = useCallback(
    async (branch: string) => {
      await switchBranchMutation.mutateAsync(branch);
    },
    [switchBranchMutation],
  );

  const switchModeMutation = useMutation({
    mutationFn: (mode: 'local' | 'worktree') => switchSessionMode(sessionId, mode),
    onSuccess: () => invalidateWorkspaceQueries(queryClient, sessionId, 'session'),
  });

  const switchMode = useCallback(
    async (mode: 'local' | 'worktree') => {
      await switchModeMutation.mutateAsync(mode);
    },
    [switchModeMutation],
  );

  const stageMutation = useMutation({
    mutationFn: (filePath: string) => stageReviewFile(sessionId, filePath),
    onSuccess: () => invalidateWorkspaceQueries(queryClient, sessionId, 'files'),
  });

  const revertMutation = useMutation({
    mutationFn: (filePath: string) => revertReviewFile(sessionId, filePath),
    onSuccess: () => invalidateWorkspaceQueries(queryClient, sessionId, 'files'),
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

  const unstageMutation = useMutation({
    mutationFn: (filePath: string) => unstageReviewFile(sessionId, filePath),
    onSuccess: () => invalidateWorkspaceQueries(queryClient, sessionId, 'files'),
  });

  const unstageFile = useCallback(
    async (filePath: string) => {
      await unstageMutation.mutateAsync(filePath);
    },
    [unstageMutation],
  );

  const stageAllMutation = useMutation({
    mutationFn: () => stageAllReviewFiles(sessionId),
    onSuccess: () => invalidateWorkspaceQueries(queryClient, sessionId, 'files'),
  });

  const stageAll = useCallback(async () => {
    await stageAllMutation.mutateAsync();
  }, [stageAllMutation]);

  const unstageAllMutation = useMutation({
    mutationFn: () => unstageAllReviewFiles(sessionId),
    onSuccess: () => invalidateWorkspaceQueries(queryClient, sessionId, 'files'),
  });

  const unstageAll = useCallback(async () => {
    await unstageAllMutation.mutateAsync();
  }, [unstageAllMutation]);

  const commitChangesMutation = useMutation({
    mutationFn: ({ message, includeUnstaged }: { message: string; includeUnstaged: boolean }) =>
      commitWorkspaceChanges(sessionId, message, includeUnstaged),
    onSuccess: () => invalidateWorkspaceQueries(queryClient, sessionId, 'git'),
  });

  const commitChanges = useCallback(
    async (message: string, includeUnstaged = false) => {
      await commitChangesMutation.mutateAsync({ message, includeUnstaged });
    },
    [commitChangesMutation],
  );

  const pushChangesMutation = useMutation({
    mutationFn: () => pushWorkspaceChanges(sessionId),
    onSuccess: () => invalidateWorkspaceQueries(queryClient, sessionId, 'git'),
  });

  const pushChanges = useCallback(async () => {
    return pushChangesMutation.mutateAsync();
  }, [pushChangesMutation]);

  const pullChangesMutation = useMutation({
    mutationFn: () => pullWorkspaceChanges(sessionId),
    onSuccess: () => invalidateWorkspaceQueries(queryClient, sessionId, 'git'),
  });

  const pullChanges = useCallback(async () => {
    return pullChangesMutation.mutateAsync();
  }, [pullChangesMutation]);

  const mergeBranchMutation = useMutation({
    mutationFn: (branch: string) => mergeSessionBranch(sessionId, branch),
    onSuccess: () => invalidateWorkspaceQueries(queryClient, sessionId, 'session'),
  });

  const mergeBranch = useCallback(
    async (branch: string) => {
      await mergeBranchMutation.mutateAsync(branch);
    },
    [mergeBranchMutation],
  );

  const mergeMutation = useMutation({
    mutationFn: (commitMessage?: string) => mergeSession(sessionId, commitMessage),
    onSuccess: () => invalidateWorkspaceQueries(queryClient, sessionId, 'session'),
  });

  const mergeSessionFn = useCallback(
    async (commitMessage?: string) => {
      await mergeMutation.mutateAsync(commitMessage);
    },
    [mergeMutation],
  );

  const discardMutation = useMutation({
    mutationFn: () => discardSession(sessionId),
    onSuccess: () => invalidateWorkspaceQueries(queryClient, sessionId, 'session'),
  });

  const discardSessionFn = useCallback(async () => {
    await discardMutation.mutateAsync();
  }, [discardMutation]);

  return {
    reviewData,
    isLoadingReview,
    refetchReview,
    branches,
    switchBranch,
    isSwitchingBranch: switchBranchMutation.isPending,
    switchMode,
    isSwitchingMode: switchModeMutation.isPending,
    stageFile,
    revertFile,
    unstageFile,
    stageAll,
    unstageAll,
    commitChanges,
    pushChanges,
    pullChanges,
    mergeBranch,
    isMergingBranch: mergeBranchMutation.isPending,
    isPushing: pushChangesMutation.isPending,
    isPulling: pullChangesMutation.isPending,
    isCommitting: commitChangesMutation.isPending,
    isStagingAll: stageAllMutation.isPending,
    isUnstagingAll: unstageAllMutation.isPending,
    mergeSession: mergeSessionFn,
    isMergingSession: mergeMutation.isPending,
    discardSession: discardSessionFn,
    isDiscardingSession: discardMutation.isPending,
  };
}
