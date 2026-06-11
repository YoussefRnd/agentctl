import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ACPEventRow } from '@agentctl/shared';
import { SessionEngine } from '@agentctl/shared';

import { apiClient } from '@agentctl/api-client';

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

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    const engine = new SessionEngine({
      sessionId,
      wsUrl,
      onEventsUpdate: (newEvents) => {
        queryClient.setQueryData<ACPEventRow[]>(['events', sessionId], (old = []) => {
          // Upsert: replace in-place for existing IDs (streaming updates), append for new ones
          const idToIndex = new Map(old.map((e, i) => [e.id, i]));
          const result = [...old];
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
      },
      onStatusChange: (status) => {
        setIsConnected(status);
      },
      onStreamingChange: (id) => {
        setStreamingEventId(id);
      },
    });

    engineRef.current = engine;
    engine.connect();

    return () => {
      engine.disconnect();
      engineRef.current = null;
    };
  }, [sessionId, queryClient]);

  // 3. Handle subscription once history is loaded
  useEffect(() => {
    if (isConnected && !isLoading && sessionId && engineRef.current) {
      const lastEventId = history.length > 0 ? history[history.length - 1].id : 0;
      engineRef.current.subscribe(lastEventId);
    }
  }, [isConnected, isLoading, sessionId, history]);

  const sendMessage = (payload: unknown) => {
    engineRef.current?.sendMessage(payload);
  };

  return { events: history, isLoading, error, refetch, sendMessage, isConnected, streamingEventId };
}
