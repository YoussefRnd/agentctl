import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SessionEventRow } from '@agentctl/shared';
import { SessionEngine } from '@agentctl/shared';

import { apiClient, getDesktopCapability } from '@agentctl/api-client';
import { getApiBaseUrl } from '@/shared/lib/api-base-url';

const fetchEvents = async (sessionId: string): Promise<SessionEventRow[]> => {
  return apiClient.fetch<SessionEventRow[]>(`/api/sessions/${sessionId}/events`);
};

export function useSessionEvents(sessionId: string | null) {
  const queryClient = useQueryClient();
  const [isConnected, setIsConnected] = useState(false);
  const [streamingEventId, setStreamingEventId] = useState<number | null>(null);
  const engineRef = useRef<SessionEngine | null>(null);

  // 1. Fetch historical data
  const {
    data: history = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['events', sessionId],
    queryFn: () => (sessionId ? fetchEvents(sessionId) : Promise.resolve([])),
    enabled: !!sessionId,
  });

  // 2. Setup SessionEngine
  useEffect(() => {
    if (!sessionId) return;

    const token = getDesktopCapability() ?? undefined;
    const sseUrl = `${getApiBaseUrl()}/api/sessions/${sessionId}/events/stream`;

    const engine = new SessionEngine({
      sessionId,
      sseUrl,
      token,
      onEventsUpdate: (newEvents) => {
        queryClient.setQueryData<SessionEventRow[]>(['events', sessionId], (old = []) => {
          const lastOldId = old.length > 0 ? old[old.length - 1].id : 0;
          const hasOptimistic = old.some((e) => e.id < 0);
          const hasRealUserMessage = newEvents.some(
            (evt) => evt.type === 'text' && evt.data.role === 'user',
          );

          // Fast path: Pure append of new sequential non-delta events
          const isSimpleAppend =
            !hasOptimistic &&
            !hasRealUserMessage &&
            old.length > 0 &&
            newEvents.every(
              (evt) => !('delta' in (evt as { delta?: string })) && evt.id > lastOldId,
            );

          if (isSimpleAppend) {
            return [...old, ...newEvents];
          }

          // Upsert: replace in-place for existing IDs (streaming updates), append for new ones
          const idToIndex = new Map(old.map((e, i) => [e.id, i]));
          const result = [...old];

          // Check if any incoming event is a real user message, and remove the temp optimistic event once
          if (hasRealUserMessage) {
            const tempIdx = result.findIndex(
              (e) => e.id < 0 && e.type === 'text' && e.data.role === 'user',
            );
            if (tempIdx !== -1) {
              result.splice(tempIdx, 1);
              // Rebuild the index mapping because indexes have shifted
              idToIndex.clear();
              result.forEach((e, idx) => idToIndex.set(e.id, idx));
            }
          }

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
          return result;
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
      engineRef.current = null;
    };
  }, [sessionId, queryClient]);

  // 3. Connect to SessionEngine once history is loaded
  useEffect(() => {
    if (!isLoading && sessionId && engineRef.current && !engineRef.current.getIsConnected()) {
      const engine = engineRef.current;
      const lastEventId = history.length > 0 ? history[history.length - 1].id : 0;
      engine.connect(lastEventId);
    }
  }, [isLoading, sessionId, history]);

  return { events: history, isLoading, error, refetch, isConnected, streamingEventId };
}
