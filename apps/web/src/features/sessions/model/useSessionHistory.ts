import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  sessionEventPageSchema,
  type SessionEventPage,
  type SessionEventRow,
} from '@agentctl/shared';
import { apiClient } from '@agentctl/api-client';

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
interface HistoryWindow {
  generation?: number;
  anchors?: number[];
  start?: number;
  end?: number;
  before: number | null;
  after: number | null;
}
type Operation = { beforeId: number } | { afterId: number } | { aroundId: number };
const WINDOW_EVENT_LIMIT = 1000;
const LIVE_EVENT_LIMIT = 200;

export function useSessionHistory(sessionId: string | null) {
  const client = useQueryClient();
  const [windows, setWindows] = useState<Record<string, HistoryWindow>>({});
  const windowsRef = useRef(windows);
  const latestRef = useRef(new Map<string, HistoryWindow>());
  const generation = useRef(0);
  const requests = useRef(new Map<string, { controller: AbortController; operation: Operation }>());
  const failures = useRef(new Map<string, Operation>());
  const [loading, setLoading] = useState<Record<string, Operation | undefined>>({});
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const setWindow = useCallback(
    (id: string, value: HistoryWindow) => {
      windowsRef.current = { ...windowsRef.current, [id]: value };
      setWindows(windowsRef.current);
      client.setQueryData(['events-cursor', id], value.before);
      client.setQueryData(['events-window', id], value);
    },
    [client],
  );
  const fetchPage = useCallback(async (id: string, operation?: Operation, signal?: AbortSignal) => {
    const query = new URLSearchParams({ limit: '200' });
    if (operation)
      for (const [key, value] of Object.entries(operation)) query.set(key, String(value));
    const url = `/api/sessions/${id}/events/page?${query}`;
    return sessionEventPageSchema.parse(
      signal ? await apiClient.fetch(url, { signal }) : await apiClient.fetch(url),
    );
  }, []);
  const resetWindow = useCallback(
    (id: string, page: SessionEventPage) => {
      generation.current++;
      requests.current.get(id)?.controller.abort();
      requests.current.delete(id);
      const window = { before: page.nextBeforeId, after: null, generation: generation.current };
      latestRef.current.set(id, {
        ...window,
        start: page.nextBeforeId ?? page.events.find((event) => event.id > 0)?.id,
        anchors:
          page.nextBeforeId == null
            ? []
            : page.events.filter((event) => event.id < page.nextBeforeId!).map((event) => event.id),
      });
      client.setQueryData(['events-latest-window', id], latestRef.current.get(id));
      setWindow(id, window);
      failures.current.delete(id);
      setErrors((errors) => ({ ...errors, [id]: null }));
      setLoading((loading) => ({ ...loading, [id]: undefined }));
    },
    [setWindow, client],
  );
  const query = useQuery({
    queryKey: ['events', sessionId],
    queryFn: async () => {
      if (!sessionId) return [];
      const page = await fetchPage(sessionId);
      resetWindow(sessionId, page);
      return page.events;
    },
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    enabled: !!sessionId,
  });
  const events = query.data ?? [];
  const window = sessionId
    ? (windows[sessionId] ?? client.getQueryData<HistoryWindow>(['events-window', sessionId]))
    : undefined;
  const before =
    window?.before ??
    (window ? null : (client.getQueryData<number | null>(['events-cursor', sessionId]) ?? null));
  const after = window?.after ?? null;
  const visibleEvents = useMemo(
    () =>
      events.filter((event) =>
        event.id < 0
          ? window?.end === undefined
          : window?.anchors?.includes(event.id) ||
            ((window?.start === undefined || event.id >= window.start) &&
              (window?.end === undefined || event.id <= window.end)),
      ),
    [events, window],
  );

  const load = useCallback(
    async (operation: Operation) => {
      if (!sessionId) return;
      const running = requests.current.get(sessionId);
      if (running) {
        if (
          !('aroundId' in operation) ||
          ('aroundId' in running.operation && running.operation.aroundId === operation.aroundId)
        )
          return;
        running.controller.abort();
      }
      const controller = new AbortController();
      requests.current.set(sessionId, { controller, operation });
      const version = generation.current;
      setLoading((loading) => ({ ...loading, [sessionId]: operation }));
      setErrors((errors) => ({ ...errors, [sessionId]: null }));
      try {
        const page = await fetchPage(sessionId, operation, controller.signal);
        if (controller.signal.aborted || version !== generation.current) return;
        const previous = windowsRef.current[sessionId] ??
          client.getQueryData<HistoryWindow>(['events-window', sessionId]) ?? {
            before,
            after: null,
          };
        let next: HistoryWindow;
        if ('aroundId' in operation)
          next = {
            generation: previous.generation,
            start: operation.aroundId,
            end: page.nextAfterId != null ? page.events.at(-1)?.id : undefined,
            before: page.nextBeforeId,
            after: page.nextAfterId ?? null,
          };
        else if ('afterId' in operation)
          next = {
            ...previous,
            end: page.nextAfterId != null ? page.events.at(-1)?.id : undefined,
            after: page.nextAfterId ?? null,
          };
        else
          next = {
            ...previous,
            start:
              previous.start === undefined
                ? undefined
                : (page.nextBeforeId ?? page.events.find((event) => event.id > 0)?.id),
            before: page.nextBeforeId,
          };
        const current = client.getQueryData<SessionEventRow[]>(['events', sessionId]) ?? [];
        const merged = mergeEventHistory(page.events, current);
        const active = merged.filter(
          (event) =>
            event.id > 0 &&
            (next.start === undefined || event.id >= next.start) &&
            (next.end === undefined || event.id <= next.end),
        );
        const kept =
          'beforeId' in operation
            ? active.slice(0, WINDOW_EVENT_LIMIT)
            : active.slice(-WINDOW_EVENT_LIMIT);
        if (active.length > kept.length) {
          if ('beforeId' in operation) {
            next.end = kept.at(-1)!.id;
            next.after = next.end;
          } else {
            next.start = kept[0].id;
            next.before = next.start;
          }
        }
        const latest =
          latestRef.current.get(sessionId) ??
          client.getQueryData<HistoryWindow>(['events-latest-window', sessionId]);
        const keepIds = new Set(
          [...kept, ...merged.filter((event) => event.id > 0).slice(-LIVE_EVENT_LIMIT)].map(
            (event) => event.id,
          ),
        );
        client.setQueryData(
          ['events', sessionId],
          merged.filter(
            (event) => event.id < 0 || keepIds.has(event.id) || latest?.anchors?.includes(event.id),
          ),
        );
        setWindow(sessionId, next);
        failures.current.delete(sessionId);
      } catch (error) {
        if (controller.signal.aborted || version !== generation.current) return;
        failures.current.set(sessionId, operation);
        setErrors((errors) => ({
          ...errors,
          [sessionId]: error instanceof Error ? error.message : String(error),
        }));
      } finally {
        if (requests.current.get(sessionId)?.controller === controller) {
          requests.current.delete(sessionId);
          setLoading((loading) => ({ ...loading, [sessionId]: undefined }));
        }
      }
    },
    [sessionId, before, client, fetchPage, setWindow],
  );
  const loadOlder = useCallback(async () => {
    if (query.error) {
      await query.refetch();
      return;
    }
    if (before != null) await load({ beforeId: before });
  }, [before, load, query.error, query.refetch]);
  const loadNewer = useCallback(async () => {
    if (after != null) await load({ afterId: after });
  }, [after, load]);
  const loadEvent = useCallback(
    async (aroundId: number) => {
      await load({ aroundId });
    },
    [load],
  );
  const retryHistory = useCallback(async () => {
    const failed = sessionId ? failures.current.get(sessionId) : undefined;
    if (failed) await load(failed);
    else await loadOlder();
  }, [sessionId, load, loadOlder]);
  const returnToLatest = useCallback(() => {
    if (!sessionId) return;
    generation.current++;
    requests.current.get(sessionId)?.controller.abort();
    requests.current.delete(sessionId);
    const current = client.getQueryData<SessionEventRow[]>(['events', sessionId]) ?? [];
    const latest =
      latestRef.current.get(sessionId) ??
      client.getQueryData<HistoryWindow>(['events-latest-window', sessionId]);
    const tail = current
      .filter((event) => event.id > 0 && (latest?.start === undefined || event.id >= latest.start))
      .slice(-LIVE_EVENT_LIMIT);
    setWindow(sessionId, {
      generation: generation.current,
      start: tail[0]?.id,
      anchors: latest?.anchors,
      before:
        latest?.before != null ||
        (latest?.start !== undefined && tail[0]?.id !== undefined && tail[0].id > latest.start)
          ? (tail[0]?.id ?? null)
          : null,
      after: null,
    });
    setLoading((loading) => ({ ...loading, [sessionId]: undefined }));
    setErrors((errors) => ({ ...errors, [sessionId]: null }));
    failures.current.delete(sessionId);
  }, [sessionId, client, setWindow]);
  useEffect(
    () => () => {
      if (sessionId) requests.current.get(sessionId)?.controller.abort();
    },
    [sessionId],
  );
  const trimLiveHistory = useCallback(
    (rows: SessionEventRow[]) => {
      if (!sessionId) return rows;
      const bounds =
        windowsRef.current[sessionId] ??
        client.getQueryData<HistoryWindow>(['events-window', sessionId]);
      const persisted = rows.filter((event) => event.id > 0);
      const active = persisted.filter(
        (event) =>
          (bounds?.start === undefined || event.id >= bounds.start) &&
          (bounds?.end === undefined || event.id <= bounds.end),
      );
      const kept = active.slice(-WINDOW_EVENT_LIMIT);
      if (bounds && active.length > kept.length)
        setWindow(sessionId, { ...bounds, start: kept[0].id, before: kept[0].id });
      const latest =
        latestRef.current.get(sessionId) ??
        client.getQueryData<HistoryWindow>(['events-latest-window', sessionId]);
      const ids = new Set(
        [...kept, ...persisted.slice(-LIVE_EVENT_LIMIT)].map((event) => event.id),
      );
      return rows.filter(
        (event) => event.id < 0 || ids.has(event.id) || latest?.anchors?.includes(event.id),
      );
    },
    [sessionId, setWindow, client],
  );
  const operation = sessionId ? loading[sessionId] : undefined;
  return {
    events,
    visibleEvents,
    historyRevision: window?.generation ?? 0,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
    hasMore: before != null || after != null,
    hasOlder: before != null,
    hasNewer: after != null,
    loadOlder,
    loadNewer,
    loadEvent,
    retryHistory,
    returnToLatest,
    resetWindow,
    trimLiveHistory,
    isLoadingOlder: !!operation && !('afterId' in operation),
    isLoadingNewer: !!operation && 'afterId' in operation,
    historyError: query.error?.message ?? (sessionId ? (errors[sessionId] ?? null) : null),
  };
}
