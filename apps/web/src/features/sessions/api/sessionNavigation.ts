import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { api, apiClient } from '@agentctl/api-client';
import { sessionEventPageSchema } from '@agentctl/shared';
import { sessionKeys } from '@/shared/lib/queryKeys';

export const sessionDetailOptions = (sessionId: string) =>
  queryOptions({
    queryKey: sessionKeys.detail(sessionId),
    queryFn: async () => {
      const response = await api.getSessionById({ params: { id: sessionId } });
      if (response.status !== 200)
        throw new Error(`Failed to fetch session: ${String(response.status)}`);
      return response.body;
    },
    enabled: !!sessionId,
  });

// Cache only the first page briefly. The history hook still owns cursor/window
// initialization, so prefetching cannot reset an already open conversation.
const INITIAL_HISTORY_FRESH_MS = 5_000;

export type SessionHistoryCursor =
  | { beforeId: number }
  | { afterId: number }
  | { aroundId: number };

export async function fetchSessionHistoryPage(
  sessionId: string,
  cursor?: SessionHistoryCursor,
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({ limit: '200', compact: 'true' });
  if (cursor) for (const [key, value] of Object.entries(cursor)) query.set(key, String(value));
  const url = `/api/sessions/${encodeURIComponent(sessionId)}/events/page?${query}`;
  const body = signal ? await apiClient.fetch(url, { signal }) : await apiClient.fetch(url);
  return sessionEventPageSchema.parse(body);
}

export const initialHistoryOptions = (sessionId: string) =>
  queryOptions({
    queryKey: sessionKeys.initialHistory(sessionId),
    queryFn: () => fetchSessionHistoryPage(sessionId),
    staleTime: INITIAL_HISTORY_FRESH_MS,
    gcTime: 30_000,
    retry: false,
  });

export function getPrefetchedHistory(client: QueryClient, sessionId: string) {
  const options = initialHistoryOptions(sessionId);
  const state = client.getQueryState(options.queryKey);
  if (
    state?.fetchStatus === 'fetching' ||
    (state?.status === 'success' && Date.now() - state.dataUpdatedAt < INITIAL_HISTORY_FRESH_MS)
  )
    return client.fetchQuery(options);
}

const pendingByClient = new WeakMap<QueryClient, Map<string, Promise<void>>>();

export function prefetchSessionNavigation(client: QueryClient, sessionId: string): Promise<void> {
  let pending = pendingByClient.get(client);
  if (!pending) {
    pending = new Map();
    pendingByClient.set(client, pending);
  }
  const existing = pending.get(sessionId);
  if (existing) return existing;
  // Intent can move rapidly down the sidebar. Limit speculative work to two sessions.
  if (pending.size >= 2) return Promise.resolve();
  const request = Promise.all([
    client.prefetchQuery({ ...sessionDetailOptions(sessionId), retry: false }),
    client.getQueryData(sessionKeys.events(sessionId)) === undefined
      ? client.prefetchQuery(initialHistoryOptions(sessionId))
      : Promise.resolve(),
  ])
    .then(() => undefined)
    .finally(() => {
      pending.delete(sessionId);
    });
  pending.set(sessionId, request);
  return request;
}
