import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { SessionEventRow } from '@agentctl/shared';
import { SessionEngine } from '@agentctl/shared';
import { toast } from 'sonner';

import { getDesktopCapability } from '@agentctl/api-client';
import { getApiBaseUrl } from '@/shared/lib/api-base-url';
import { sessionKeys } from '@/shared/lib/queryKeys';
import { observePromptPerformance, cancelPromptPerformance } from '@/shared/lib/promptPerformance';
import { reconcileOptimisticMessages } from './reconcileOptimisticMessages';
import { useMessageQueueStore } from '@/shared/stores/useMessageQueueStore';

import { useSessionHistory, mergeEventHistory } from './useSessionHistory';
export { mergeEventHistory } from './useSessionHistory';

export function useSessionEvents(sessionId: string | null) {
  const queryClient = useQueryClient();
  const [isConnected, setIsConnected] = useState(false);
  const [streamingEventId, setStreamingEventId] = useState<number | null>(null);
  const engineRef = useRef<SessionEngine | null>(null);
  const startedEngineRef = useRef<SessionEngine | null>(null);
  const historyState = useSessionHistory(sessionId);
  const { events: history, isLoading, error, resetWindow, trimLiveHistory } = historyState;

  // 2. Setup SessionEngine
  useEffect(() => {
    if (!sessionId) return;

    const token = getDesktopCapability() ?? undefined;
    const sseUrl = `${getApiBaseUrl()}/api/sessions/${sessionId}/events/stream`;
    const reconcileOutbox = (events: SessionEventRow[]) => {
      const store = useMessageQueueStore.getState();
      let hasUserUpdate = false;
      for (const event of events) {
        if (
          event.id > 0 &&
          event.type === 'text' &&
          event.data.role === 'user' &&
          event.data.clientMessageId
        ) {
          hasUserUpdate = true;
          if (
            store.queuedMessages[sessionId]?.some(
              (message) => message.id === event.data.clientMessageId,
            )
          )
            store.dequeueMessage(sessionId, event.data.clientMessageId);
        }
      }
      if (hasUserUpdate) {
        void queryClient.invalidateQueries({ queryKey: ['session-execution', sessionId] });
        void queryClient.invalidateQueries({ queryKey: sessionKeys.turnIndex(sessionId) });
      }
    };

    const engine = new SessionEngine({
      sessionId,
      sseUrl,
      token,
      onNotice: (notice) => {
        const options = { description: notice.description };
        if (notice.severity === 'error') toast.error(notice.title, options);
        else if (notice.severity === 'warning') toast.warning(notice.title, options);
        else if (notice.severity === 'info') toast.info(notice.title, options);
        else toast(notice.title, options);
      },
      onHistorySnapshot: (snapshot) => {
        reconcileOutbox(snapshot.events);
        observePromptPerformance(sessionId, snapshot.events);
        void queryClient.invalidateQueries({ queryKey: sessionKeys.turnIndex(sessionId) });
        resetWindow(sessionId, snapshot);
        queryClient.setQueryData<SessionEventRow[]>(['events', sessionId], (old = []) =>
          mergeEventHistory(
            snapshot.events,
            reconcileOptimisticMessages(
              old.filter((event) => event.id < 0),
              snapshot.events,
            ),
          ),
        );
        void queryClient.invalidateQueries({ queryKey: sessionKeys.detail(sessionId) });
      },
      onEventsUpdate: (newEvents) => {
        reconcileOutbox(newEvents);
        observePromptPerformance(sessionId, newEvents);
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
            return trimLiveHistory([...old, ...newEvents]);
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
          return trimLiveHistory(mergeEventHistory([], result));
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
      cancelPromptPerformance(sessionId);
      engine.disconnect();
      if (startedEngineRef.current === engine) startedEngineRef.current = null;
      if (engineRef.current === engine) engineRef.current = null;
    };
  }, [sessionId, queryClient, resetWindow, trimLiveHistory]);

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
    ...historyState,
    isConnected,
    streamingEventId,
  };
}
