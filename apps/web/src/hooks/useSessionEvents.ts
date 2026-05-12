import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ACPEventRow } from '@agentctl/server/src/types.js';

const fetchEvents = async (sessionId: string): Promise<ACPEventRow[]> => {
  const token = 'your-secret-here'; // For prototype
  const res = await fetch(`/api/sessions/${sessionId}/events`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error('Network response was not ok');
  return res.json() as Promise<ACPEventRow[]>;
};

export function useSessionEvents(sessionId: string | null) {
  const queryClient = useQueryClient();
  const queryKey = ['events', sessionId];
  
  // 1. Fetch historical data
  const { data: history = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => sessionId ? fetchEvents(sessionId) : Promise.resolve([]),
    enabled: !!sessionId,
  });

  // 2. Setup WS Buffer
  const bufferRef = useRef<ACPEventRow[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!sessionId) return;

    // Connect WebSocket
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      // Determine last known ID from current cache to catch up
      const currentCache = queryClient.getQueryData<ACPEventRow[]>(queryKey) ?? [];
      const lastEventId = currentCache.length > 0 ? currentCache[currentCache.length - 1].id : 0;
      
      ws.send(JSON.stringify({
        action: 'subscribe',
        sessionId,
        lastEventId
      }));
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
        queryClient.setQueryData<ACPEventRow[]>(queryKey, (old = []) => {
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
  }, [sessionId, queryClient, queryKey]);

  return { events: history, isLoading };
}
