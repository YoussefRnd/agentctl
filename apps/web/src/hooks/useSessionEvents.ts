import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ACPEventRow } from '@agentctl/shared';
import { SessionEngine } from '@agentctl/shared';

import { apiClient } from '@agentctl/api-client';
import { getApiBaseUrl } from '../lib/api-base-url';

const fetchEvents = async (sessionId: string): Promise<ACPEventRow[]> => {
  return apiClient.fetch<ACPEventRow[]>(`/api/sessions/${sessionId}/events`);
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

    const token = localStorage.getItem('agentctl_token') ?? undefined;
    const sseUrl = `${getApiBaseUrl()}/api/sessions/${sessionId}/events/stream`;

    const engine = new SessionEngine({
      sessionId,
      sseUrl,
      token,
      onEventsUpdate: (newEvents) => {
        queryClient.setQueryData<ACPEventRow[]>(['events', sessionId], (old = []) => {
          // Upsert: replace in-place for existing IDs (streaming updates), append for new ones
          const idToIndex = new Map(old.map((e, i) => [e.id, i]));
          const result = [...old];

          // Check if any incoming event is a real user message, and remove the temp optimistic event once
          const hasRealUserMessage = newEvents.some(
            (evt) => evt.type === 'text' && evt.data.role === 'user',
          );
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
              result[idx] = evt; // update in-place
            } else {
              idToIndex.set(evt.id, result.length);
              result.push(evt); // append new
            }
          }
          return result;
        });
        void queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
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
