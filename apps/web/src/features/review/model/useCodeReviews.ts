import { useEffect } from 'react';
import { useMutation, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import {
  listCodeReviews,
  startCodeReview,
  cancelCodeReview,
  resolveCodeReviewFinding,
} from '@agentctl/api-client';
import type { StartCodeReview, ResolveReviewFinding, RepositoryCapture } from '@agentctl/shared';
import { sessionKeys } from '@/shared/lib/queryKeys';

export function useCodeReviews(sessionId: string, capture?: RepositoryCapture) {
  const client = useQueryClient();
  const key = sessionKeys.codeReviews(sessionId);
  const query = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ signal, pageParam }) => listCodeReviews(sessionId, signal, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: !!sessionId,
    refetchOnWindowFocus: true,
    refetchInterval: (query) =>
      query.state.data?.pages[0]?.runs.some(
        (run) => run.status === 'running' || (run.verificationSummary?.running ?? 0) > 0,
      )
        ? 2000
        : false,
  });
  useEffect(() => {
    void client.invalidateQueries({ queryKey: sessionKeys.codeReviews(sessionId) });
  }, [client, sessionId, capture?.current, capture?.working, capture?.baseline]);
  const refresh = () => {
    void client.invalidateQueries({ queryKey: key });
  };
  const start = useMutation({
    mutationFn: (body: StartCodeReview) => startCodeReview(sessionId, body),
    onSuccess: refresh,
  });
  const cancel = useMutation({
    mutationFn: (id: string) => cancelCodeReview(sessionId, id),
    onSuccess: refresh,
  });
  const resolve = useMutation({
    mutationFn: ({
      reviewId,
      findingId,
      ...body
    }: ResolveReviewFinding & { reviewId: string; findingId: string }) =>
      resolveCodeReviewFinding(sessionId, reviewId, findingId, body),
    onSuccess: refresh,
  });
  return {
    query: { ...query, data: query.data?.pages.flatMap((page) => page.runs) },
    start,
    cancel,
    resolve,
  };
}
