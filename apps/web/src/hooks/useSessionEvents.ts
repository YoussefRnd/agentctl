import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ACPEventRow } from '@agentctl/shared';

import { apiClient } from '../lib/api-client';

const fetchEvents = async (sessionId: string): Promise<ACPEventRow[]> => {
  return apiClient.fetch<ACPEventRow[]>(`/api/sessions/${sessionId}/events`);
};

export function useSessionEvents(sessionId: string | null) {
  const queryClient = useQueryClient();
  const [isConnected, setIsConnected] = useState(false);
  
  // 1. Fetch historical data
  const { data: history = [], isLoading } = useQuery({
    queryKey: ['events', sessionId],
    queryFn: () => sessionId ? fetchEvents(sessionId) : Promise.resolve([]),
    enabled: !!sessionId,
  });

  // 2. Setup WS Buffer
  const bufferRef = useRef<ACPEventRow[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  const sendMessage = (payload: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
    }
  };

  useEffect(() => {
    if (!sessionId) return;

    // Connect WebSocket
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      // Determine last known ID from current cache to catch up
      const currentCache = queryClient.getQueryData<ACPEventRow[]>(['events', sessionId]) ?? [];
      const lastEventId = currentCache.length > 0 ? currentCache[currentCache.length - 1].id : 0;
      
      ws.send(JSON.stringify({
        action: 'subscribe',
        sessionId,
        lastEventId
      }));
    };

    ws.onclose = () => {
      setIsConnected(false);
    };

    ws.onmessage = (event) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      const msg = JSON.parse(event.data) as { type?: string; payload?: unknown };
      if (msg.type === 'acp_event') {
        bufferRef.current.push(msg.payload as ACPEventRow);
      }
    };

    // Throttle flush buffer to cache
    const flushInterval = setInterval(() => {
      if (bufferRef.current.length > 0) {
        queryClient.setQueryData<ACPEventRow[]>(['events', sessionId], (old = []) => {
          const newEvents = [...bufferRef.current];
          bufferRef.current = [];
          
          // Deduplicate
          const existingIds = new Set(old.map(e => e.id));
          const uniqueNew = newEvents.filter(e => !existingIds.has(e.id));
          
          return [...old, ...uniqueNew];
        });
      }
    }, 100);

    return () => {
      clearInterval(flushInterval);
      ws.close();
    };
  }, [sessionId, queryClient]);

  return { events: history, isLoading, sendMessage, isConnected };
}
