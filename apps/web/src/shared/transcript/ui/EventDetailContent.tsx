import { useQuery, useQueries, queryOptions } from '@tanstack/react-query';
import { fetchSessionEventDetail } from '@agentctl/api-client';
import type { ReactNode } from 'react';
import type { SessionEventRow } from '@agentctl/shared';

function detailOptions(event: SessionEventRow) {
  return queryOptions({
    queryKey: ['event-detail', event.sessionId, event.id, event.details?.revision],
    queryFn: async ({ signal }) => {
      const result = await fetchSessionEventDetail(event.sessionId, event.id, signal);
      if (result.type !== event.type) throw new Error('Event changed. Refresh the conversation.');
      return result;
    },
    staleTime: Infinity,
    // Full output belongs to expanded views, not the long-lived history cache.
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

function DetailState({ error, retry }: { error?: boolean; retry: () => void }) {
  return error ? (
    <div role="alert" className="text-text-muted text-xs">
      Could not load output.{' '}
      <button type="button" className="underline" onClick={retry}>
        Retry
      </button>
    </div>
  ) : (
    <p role="status" className="text-text-muted text-xs">
      Loading output…
    </p>
  );
}

function LoadedEvent({
  event,
  children,
}: {
  event: SessionEventRow;
  children: (event: SessionEventRow) => ReactNode;
}) {
  const query = useQuery(detailOptions(event));
  return query.data ? (
    children(query.data)
  ) : (
    <DetailState
      error={query.isError}
      retry={() => {
        void query.refetch();
      }}
    />
  );
}

export function EventDetailContent({
  event,
  children,
}: {
  event: SessionEventRow;
  children: (event: SessionEventRow) => ReactNode;
}) {
  return event.details ? (
    <LoadedEvent key={`${event.sessionId}:${event.id}:${event.details.revision}`} event={event}>
      {children}
    </LoadedEvent>
  ) : (
    children(event)
  );
}

/** Mounted only for an expanded terminal; repeated rows share revision-scoped queries. */
function LoadedEventGroup({
  events,
  children,
}: {
  events: SessionEventRow[];
  children: (events: SessionEventRow[]) => ReactNode;
}) {
  const pending = events.filter((event) => event.details);
  const queries = useQueries({ queries: pending.map(detailOptions) });
  if (queries.some((query) => !query.data))
    return (
      <DetailState
        error={queries.some((query) => query.isError)}
        retry={() => {
          for (const query of queries) if (query.isError) void query.refetch();
        }}
      />
    );
  const resolved = new Map(pending.map((event, index) => [event.id, queries[index].data!]));
  return children(events.map((event) => resolved.get(event.id) ?? event));
}

export function EventDetailGroup(props: {
  events: SessionEventRow[];
  children: (events: SessionEventRow[]) => ReactNode;
}) {
  return props.events.some((event) => event.details) ? (
    <LoadedEventGroup {...props} />
  ) : (
    props.children(props.events)
  );
}
