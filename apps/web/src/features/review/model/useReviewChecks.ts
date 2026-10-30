import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listReviewChecks,
  getReviewCheck,
  runReviewCheck,
  cancelReviewCheck,
  confirmReviewFindingEvidence,
} from '@agentctl/api-client';
import type { RunReviewCheck, ConfirmFindingEvidence } from '@agentctl/shared';
import { sessionKeys } from '@/shared/lib/queryKeys';

export function useReviewChecks(sessionId: string, reviewId: string, enabled = true) {
  const client = useQueryClient();
  const key = sessionKeys.reviewChecks(sessionId, reviewId);
  const query = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ signal, pageParam }) => listReviewChecks(sessionId, reviewId, signal, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled,
    refetchInterval: (query) =>
      query.state.data?.pages.some((page) =>
        page.checks.some((check) => ['pending', 'running'].includes(check.status)),
      )
        ? 1000
        : false,
  });
  const refresh = () => {
    void client.invalidateQueries({ queryKey: key });
    void client.invalidateQueries({ queryKey: sessionKeys.codeReviews(sessionId) });
    void client.invalidateQueries({ queryKey: ['review-check-output', sessionId, reviewId] });
  };
  const start = useMutation({
    mutationFn: (body: RunReviewCheck) => runReviewCheck(sessionId, reviewId, body),
    onSuccess: refresh,
  });
  const cancel = useMutation({
    mutationFn: (id: string) => cancelReviewCheck(sessionId, reviewId, id),
    onSuccess: refresh,
  });
  const confirm = useMutation({
    mutationFn: ({ findingId, ...body }: ConfirmFindingEvidence & { findingId: string }) =>
      confirmReviewFindingEvidence(sessionId, reviewId, findingId, body),
    onSuccess: refresh,
  });
  return {
    query,
    checks: query.data?.pages.flatMap((page) => page.checks) ?? [],
    start,
    cancel,
    confirm,
  };
}
export function useReviewCheck(
  sessionId: string,
  reviewId: string,
  checkId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: sessionKeys.reviewCheck(sessionId, reviewId, checkId),
    queryFn: ({ signal }) => getReviewCheck(sessionId, reviewId, checkId, signal),
    enabled: enabled && !!checkId,
    refetchInterval: (query) =>
      query.state.data && ['pending', 'running'].includes(query.state.data.status) ? 1000 : false,
  });
}
