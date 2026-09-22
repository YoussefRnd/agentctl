import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  api,
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
import { sessionKeys } from '@/shared/lib/queryKeys';
import type { ReviewFile } from '@/features/review';

interface ReviewResponse {
  files: ReviewFile[];
}

const fetchReview = async (sessionId: string): Promise<ReviewResponse> => {
  const res = await api.getSessionReview({ params: { id: sessionId } });
  if (res.status !== 200) {
    throw new Error(`Failed to fetch session review: ${String(res.status)}`);
  }
  return {
    files: res.body.files.map((file) => ({
      path: file.path,
      state: file.state,
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
      if (res.status !== 200) {
        throw new Error(`Failed to fetch branches: ${String(res.status)}`);
      }
      return res.body;
    },
    enabled: !!sessionId,
  });

  const switchBranchMutation = useMutation({
    mutationFn: (branch: string) => patchSession(sessionId, { branch }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: sessionKeys.detail(sessionId) });
      void queryClient.invalidateQueries({ queryKey: sessionKeys.branches(sessionId) });
    },
  });

  const switchBranch = useCallback(
    async (branch: string) => {
      await switchBranchMutation.mutateAsync(branch);
    },
    [switchBranchMutation],
  );

  const switchModeMutation = useMutation({
    mutationFn: (mode: 'local' | 'worktree') => switchSessionMode(sessionId, mode),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: sessionKeys.detail(sessionId) });
    },
  });

  const switchMode = useCallback(
    async (mode: 'local' | 'worktree') => {
      await switchModeMutation.mutateAsync(mode);
    },
    [switchModeMutation],
  );

  const stageMutation = useMutation({
    mutationFn: (filePath: string) => stageReviewFile(sessionId, filePath),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: sessionKeys.review(sessionId) });
    },
  });

  const revertMutation = useMutation({
    mutationFn: (filePath: string) => revertReviewFile(sessionId, filePath),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: sessionKeys.review(sessionId) });
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

  const unstageMutation = useMutation({
    mutationFn: (filePath: string) => unstageReviewFile(sessionId, filePath),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: sessionKeys.review(sessionId) });
    },
  });

  const unstageFile = useCallback(
    async (filePath: string) => {
      await unstageMutation.mutateAsync(filePath);
    },
    [unstageMutation],
  );

  const stageAllMutation = useMutation({
    mutationFn: () => stageAllReviewFiles(sessionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: sessionKeys.review(sessionId) });
    },
  });

  const stageAll = useCallback(async () => {
    await stageAllMutation.mutateAsync();
  }, [stageAllMutation]);

  const unstageAllMutation = useMutation({
    mutationFn: () => unstageAllReviewFiles(sessionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: sessionKeys.review(sessionId) });
    },
  });

  const unstageAll = useCallback(async () => {
    await unstageAllMutation.mutateAsync();
  }, [unstageAllMutation]);

  const commitChangesMutation = useMutation({
    mutationFn: (message: string) => commitWorkspaceChanges(sessionId, message),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: sessionKeys.review(sessionId) });
      void queryClient.invalidateQueries({ queryKey: sessionKeys.gitStatus(sessionId) });
    },
  });

  const commitChanges = useCallback(
    async (message: string) => {
      await commitChangesMutation.mutateAsync(message);
    },
    [commitChangesMutation],
  );

  const pushChangesMutation = useMutation({
    mutationFn: () => pushWorkspaceChanges(sessionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: sessionKeys.review(sessionId) });
      void queryClient.invalidateQueries({ queryKey: sessionKeys.gitStatus(sessionId) });
    },
  });

  const pushChanges = useCallback(async () => {
    return pushChangesMutation.mutateAsync();
  }, [pushChangesMutation]);

  const pullChangesMutation = useMutation({
    mutationFn: () => pullWorkspaceChanges(sessionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: sessionKeys.review(sessionId) });
      void queryClient.invalidateQueries({ queryKey: sessionKeys.gitStatus(sessionId) });
    },
  });

  const pullChanges = useCallback(async () => {
    return pullChangesMutation.mutateAsync();
  }, [pullChangesMutation]);

  const mergeBranchMutation = useMutation({
    mutationFn: (branch: string) => mergeSessionBranch(sessionId, branch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: sessionKeys.review(sessionId) });
      void queryClient.invalidateQueries({ queryKey: sessionKeys.detail(sessionId) });
    },
  });

  const mergeBranch = useCallback(
    async (branch: string) => {
      await mergeBranchMutation.mutateAsync(branch);
    },
    [mergeBranchMutation],
  );

  const mergeMutation = useMutation({
    mutationFn: (commitMessage?: string) => mergeSession(sessionId, commitMessage),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: sessionKeys.detail(sessionId) });
      void queryClient.invalidateQueries({ queryKey: sessionKeys.review(sessionId) });
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
      void queryClient.invalidateQueries({ queryKey: sessionKeys.detail(sessionId) });
      void queryClient.invalidateQueries({ queryKey: sessionKeys.review(sessionId) });
    },
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
