import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getGitStatus, createPullRequest } from '@agentctl/api-client';
import type { CreatePullRequestBody, GitStatus } from '@agentctl/shared';
import { sessionKeys } from '@/shared/lib/queryKeys';

export function useGitStatus(sessionId: string) {
  const queryClient = useQueryClient();

  const {
    data: gitStatus,
    isLoading,
    error,
    refetch,
  } = useQuery<GitStatus>({
    queryKey: sessionKeys.gitStatus(sessionId),
    queryFn: () => getGitStatus(sessionId),
    enabled: !!sessionId,
    staleTime: 5000,
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
  });

  const createPullRequestMutation = useMutation({
    mutationFn: (body: CreatePullRequestBody) => createPullRequest(sessionId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: sessionKeys.gitStatus(sessionId) });
      void queryClient.invalidateQueries({ queryKey: sessionKeys.review(sessionId) });
      void queryClient.invalidateQueries({ queryKey: sessionKeys.branches(sessionId) });
    },
  });

  return {
    gitStatus: gitStatus ?? {
      isRepo: false,
      branch: null,
      hasPrimaryRemote: false,
      remoteName: null,
      remoteProvider: null,
      upstreamBranch: null,
      hasUpstream: false,
      aheadCount: 0,
      behindCount: 0,
      pr: null,
      ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}),
    },
    isLoading,
    refetch,
    createPullRequest: createPullRequestMutation.mutateAsync,
    isCreatingPullRequest: createPullRequestMutation.isPending,
  };
}
