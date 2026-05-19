import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ACPEventRow } from '@agentctl/shared';

import { apiClient } from '../api/api-client';

const fetchEvents = async (sessionId: string): Promise<ACPEventRow[]> => {
  return apiClient.fetch<ACPEventRow[]>(`/api/sessions/${sessionId}/events`);
};

export function useSessionEvents(sessionId: string | null) {
  const queryClient = useQueryClient();
  const [isConnected, setIsConnected] = useState(false);
  
  // 1. Fetch historical data
  const { data: history = [], isLoading, error, refetch } = useQuery({
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

    // Throttle flush buffer to cache using requestAnimationFrame
    let rafId: number;
    const flushBuffer = () => {
      if (bufferRef.current.length > 0) {
        queryClient.setQueryData<ACPEventRow[]>(['events', sessionId], (old = []) => {
          const newEvents = [...bufferRef.current];
          bufferRef.current = [];
          
          // Deduplicate
          const existingIds = new Set(old.map(e => e.id));
          const uniqueNew = newEvents.filter(e => !existingIds.has(e.id));
          
          if (uniqueNew.length === 0) return old;
          return [...old, ...uniqueNew];
        });
      }
      rafId = requestAnimationFrame(flushBuffer);
    };
    rafId = requestAnimationFrame(flushBuffer);

    return () => {
      cancelAnimationFrame(rafId);
      ws.close();
    };
  }, [sessionId, queryClient]);

  const subscribedRef = useRef<string | null>(null);

  // Handle subscription once history is loaded
  useEffect(() => {
    if (isConnected && !isLoading && wsRef.current?.readyState === WebSocket.OPEN && sessionId) {
      // Only subscribe once per sessionId + connection session
      if (subscribedRef.current === sessionId) return;

      const lastEventId = history.length > 0 ? history[history.length - 1].id : 0;
      
      wsRef.current.send(JSON.stringify({
        action: 'subscribe',
        sessionId,
        lastEventId
      }));
      subscribedRef.current = sessionId;
    }
  }, [isConnected, isLoading, sessionId, history.length]);

  // Reset subscription ref on disconnect
  useEffect(() => {
    if (!isConnected) {
      subscribedRef.current = null;
    }
  }, [isConnected]);

  return { events: history, isLoading, error, refetch, sendMessage, isConnected };
}
