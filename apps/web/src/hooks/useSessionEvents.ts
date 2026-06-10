import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ACPEventRow } from '@agentctl/shared';
import { toast } from 'sonner';

import { apiClient } from '@agentctl/api-client';

const fetchEvents = async (sessionId: string): Promise<ACPEventRow[]> => {
  return apiClient.fetch<ACPEventRow[]>(`/api/sessions/${sessionId}/events`);
};

export function useSessionEvents(sessionId: string | null) {
  const queryClient = useQueryClient();
  const [isConnected, setIsConnected] = useState(false);
  const [streamingEventId, setStreamingEventId] = useState<number | null>(null);
  const streamTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Keep a ref of history to read inside subscription effect without triggering re-runs
  const historyRef = useRef<ACPEventRow[]>(history);
  useEffect(() => {
    historyRef.current = history;
  }, [history]);

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
      setStreamingEventId(null);
    };

    let flushScheduled = false;
    const scheduleFlush = () => {
      if (flushScheduled) return;
      flushScheduled = true;

      requestAnimationFrame(() => {
        flushScheduled = false;
        if (bufferRef.current.length > 0) {
          queryClient.setQueryData<ACPEventRow[]>(['events', sessionId], (old = []) => {
            const newEvents = [...bufferRef.current];
            bufferRef.current = [];

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
        }
      });
    };

    ws.onmessage = (event) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      const msg = JSON.parse(event.data) as { type?: string; payload?: unknown; error?: string };
      if (msg.type === 'error' || msg.error) {
        toast.error(msg.error ?? 'A WebSocket stream error occurred');
        return;
      }

      if (msg.type === 'acp_event') {
        const payload = msg.payload as ACPEventRow;
        bufferRef.current.push(payload);
        scheduleFlush();

        // Track streaming state
        if (payload.type === 'text') {
          setStreamingEventId(payload.id);

          // Reset inactivity timeout
          if (streamTimeoutRef.current) clearTimeout(streamTimeoutRef.current);
          streamTimeoutRef.current = setTimeout(() => {
            setStreamingEventId(null);
          }, 2000); // 2s of silence = stream finished
        } else {
          // Any other event (tool call, status, etc) means text stream ended
          setStreamingEventId(null);
          if (streamTimeoutRef.current) {
            clearTimeout(streamTimeoutRef.current);
            streamTimeoutRef.current = null;
          }
        }
      }
    };

    return () => {
      if (streamTimeoutRef.current) clearTimeout(streamTimeoutRef.current);
      ws.close();
    };
  }, [sessionId, queryClient]);

  const subscribedRef = useRef<string | null>(null);

  // Handle subscription once history is loaded
  useEffect(() => {
    if (isConnected && !isLoading && wsRef.current?.readyState === WebSocket.OPEN && sessionId) {
      // Only subscribe once per sessionId + connection session
      if (subscribedRef.current === sessionId) return;

      const currentHistory = historyRef.current;
      const lastEventId = currentHistory.length > 0 ? currentHistory[currentHistory.length - 1].id : 0;

      wsRef.current.send(
        JSON.stringify({
          action: 'subscribe',
          sessionId,
          lastEventId,
        }),
      );
      subscribedRef.current = sessionId;
    }
  }, [isConnected, isLoading, sessionId]);

  // Reset subscription ref on disconnect
  useEffect(() => {
    if (!isConnected) {
      subscribedRef.current = null;
    }
  }, [isConnected]);

  return { events: history, isLoading, error, refetch, sendMessage, isConnected, streamingEventId };
}
