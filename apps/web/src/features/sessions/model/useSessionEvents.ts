import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SessionEventRow } from '@agentctl/shared';
import { SessionEngine, sessionEventPageSchema } from '@agentctl/shared';

import { apiClient, getDesktopCapability } from '@agentctl/api-client';
import { getApiBaseUrl } from '@/shared/lib/api-base-url';
import { sessionKeys } from '@/shared/lib/queryKeys';
import { reconcileOptimisticMessages } from './reconcileOptimisticMessages';

export function mergeEventHistory(
  older: SessionEventRow[],
  current: SessionEventRow[],
): SessionEventRow[] {
  const byId = new Map(older.map((event) => [event.id, event]));
  for (const event of current) byId.set(event.id, event);
  return [...byId.values()]
    .filter((event) => event.id >= 0)
    .sort((a, b) => a.id - b.id)
    .concat([...byId.values()].filter((event) => event.id < 0));
}

const fetchPage = async (sessionId: string, beforeId?: number) => {
  const query = new URLSearchParams({ limit: '200' });
  if (beforeId !== undefined) query.set('beforeId', String(beforeId));
  return sessionEventPageSchema.parse(
    await apiClient.fetch(`/api/sessions/${sessionId}/events/page?${query}`),
  );
};

export function useSessionEvents(sessionId: string | null) {
  const queryClient = useQueryClient();
  const [isConnected, setIsConnected] = useState(false);
  const [streamingEventId, setStreamingEventId] = useState<number | null>(null);
  const [pages, setPages] = useState<Record<string, number | null>>({});
  const [loadingOlderSessions, setLoadingOlderSessions] = useState<Record<string, boolean>>({});
  const [historyErrors, setHistoryErrors] = useState<Record<string, string | null>>({});
  const loadingOlderRef = useRef(new Set<string>());
  const engineRef = useRef<SessionEngine | null>(null);
  const startedEngineRef = useRef<SessionEngine | null>(null);
  const historyGeneration = useRef(0);

  // 1. Fetch historical data
  const {
    data: history = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['events', sessionId],
    queryFn: async () => {
      if (!sessionId) return [];
      const page = await fetchPage(sessionId);
      queryClient.setQueryData(['events-cursor', sessionId], page.nextBeforeId);
      setPages((pages) => ({ ...pages, [sessionId]: page.nextBeforeId }));
      return page.events;
    },
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    enabled: !!sessionId,
  });

  const historyError = error?.message ?? (sessionId ? (historyErrors[sessionId] ?? null) : null);
  const cursor = sessionId
    ? pages[sessionId] !== undefined
      ? pages[sessionId]
      : queryClient.getQueryData<number | null>(['events-cursor', sessionId])
    : null;
  const loadOlder = useCallback(async () => {
    if (error) {
      await refetch();
      return;
    }
    if (!sessionId || cursor == null || loadingOlderRef.current.has(sessionId)) return;
    loadingOlderRef.current.add(sessionId);
    const generation = historyGeneration.current;
    setLoadingOlderSessions((sessions) => ({ ...sessions, [sessionId]: true }));
    setHistoryErrors((errors) => ({ ...errors, [sessionId]: null }));
    try {
      const page = await fetchPage(sessionId, cursor);
      if (generation !== historyGeneration.current) return;
      queryClient.setQueryData<SessionEventRow[]>(['events', sessionId], (current = []) =>
        mergeEventHistory(page.events, current),
      );
      queryClient.setQueryData(['events-cursor', sessionId], page.nextBeforeId);
      setPages((pages) => ({ ...pages, [sessionId]: page.nextBeforeId }));
    } catch (error) {
      if (generation !== historyGeneration.current) return;
      setHistoryErrors((errors) => ({
        ...errors,
        [sessionId]: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      loadingOlderRef.current.delete(sessionId);
      setLoadingOlderSessions((sessions) => ({ ...sessions, [sessionId]: false }));
    }
  }, [sessionId, cursor, queryClient, error, refetch]);

  // 2. Setup SessionEngine
  useEffect(() => {
    if (!sessionId) return;

    const token = getDesktopCapability() ?? undefined;
    const sseUrl = `${getApiBaseUrl()}/api/sessions/${sessionId}/events/stream`;

    const engine = new SessionEngine({
      sessionId,
      sseUrl,
      token,
      onHistorySnapshot: (snapshot) => {
        historyGeneration.current++;
        queryClient.setQueryData<SessionEventRow[]>(['events', sessionId], (old = []) =>
          mergeEventHistory(
            snapshot.events,
            reconcileOptimisticMessages(
              old.filter((event) => event.id < 0),
              snapshot.events,
            ),
          ),
        );
        queryClient.setQueryData(['events-cursor', sessionId], snapshot.nextBeforeId);
        setPages((pages) => ({ ...pages, [sessionId]: snapshot.nextBeforeId }));
        setHistoryErrors((errors) => ({ ...errors, [sessionId]: null }));
        void queryClient.invalidateQueries({ queryKey: sessionKeys.detail(sessionId) });
      },
      onEventsUpdate: (newEvents) => {
        queryClient.setQueryData<SessionEventRow[]>(['events', sessionId], (old = []) => {
          const lastOldId = old.length > 0 ? old[old.length - 1].id : 0;
          const hasOptimistic = old.some((e) => e.id < 0);
          const realUserMessages = newEvents.filter(
            (evt) => evt.type === 'text' && evt.data.role === 'user',
          );

          // Fast path: Pure append of new sequential non-delta events
          const isSimpleAppend =
            !hasOptimistic &&
            realUserMessages.length === 0 &&
            old.length > 0 &&
            newEvents.every(
              (evt) => !('delta' in (evt as { delta?: string })) && evt.id > lastOldId,
            );

          if (isSimpleAppend) {
            return [...old, ...newEvents];
          }

          // Upsert: replace in-place for existing IDs (streaming updates), append for new ones.
          const result = reconcileOptimisticMessages(old, newEvents);
          const idToIndex = new Map(result.map((event, index) => [event.id, index]));

          for (const evt of newEvents) {
            const idx = idToIndex.get(evt.id);
            if (idx !== undefined) {
              const existing = result[idx];
              // Transient streaming events carry a wire-only `delta`: append
              // it to the existing event content instead of replacing (which
              // would otherwise hold only the last chunk).
              const delta = (evt as { delta?: string }).delta;
              if (
                delta !== undefined &&
                evt.type === 'text' &&
                existing.type === 'text' &&
                existing.data.role === evt.data.role &&
                typeof existing.data.content === 'string'
              ) {
                result[idx] = {
                  ...existing,
                  data: {
                    ...existing.data,
                    content: existing.data.content + delta,
                  },
                };
              } else {
                result[idx] = evt; // update in-place (full row)
              }
            } else {
              idToIndex.set(evt.id, result.length);
              // Defensive: transient delta for an unseen id carries no base;
              // materialize the chunk so the event is never rendered empty.
              const delta = (evt as { delta?: string }).delta;
              const materialized =
                delta !== undefined && evt.type === 'text'
                  ? {
                      ...evt,
                      data: {
                        ...evt.data,
                        content:
                          typeof evt.data.content === 'string' && evt.data.content.length > 0
                            ? evt.data.content
                            : delta,
                      },
                    }
                  : evt;
              result.push(materialized); // append new
            }
          }
          return mergeEventHistory([], result);
        });
      },
      onStatusChange: (status) => {
        setIsConnected(status);
      },
      onStreamingChange: (id) => {
        setStreamingEventId(id);
      },
    });

    engineRef.current = engine;

    return () => {
      engine.disconnect();
      if (startedEngineRef.current === engine) startedEngineRef.current = null;
      if (engineRef.current === engine) engineRef.current = null;
    };
  }, [sessionId, queryClient]);

  // 3. Connect to SessionEngine once history is loaded
  useEffect(() => {
    if (
      !isLoading &&
      !error &&
      sessionId &&
      engineRef.current &&
      startedEngineRef.current !== engineRef.current
    ) {
      const engine = engineRef.current;
      const lastEventId = history.reduce((max, event) => Math.max(max, event.id), 0);
      startedEngineRef.current = engine;
      engine.connect(lastEventId);
    }
  }, [isLoading, error, sessionId, history]);

  return {
    events: history,
    isLoading,
    error,
    refetch,
    isConnected,
    streamingEventId,
    hasMore: cursor != null,
    loadOlder,
    isLoadingOlder: !!(sessionId && loadingOlderSessions[sessionId]),
    historyError,
  };
}
