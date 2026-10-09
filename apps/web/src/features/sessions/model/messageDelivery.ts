import type { QueryClient } from '@tanstack/react-query';
import type { SessionEventRow } from '@agentctl/shared';
import { api } from '@agentctl/api-client';
import { sessionKeys } from '@/shared/lib/queryKeys';

type DeliveryStatus = 'queued' | 'sending' | 'accepted' | 'failed' | 'cancelled';
let lastOptimisticId = 0;

export function nextOptimisticEventId(): number {
  lastOptimisticId = Math.min(lastOptimisticId - 1, -Date.now());
  return lastOptimisticId;
}

/** An acknowledgment must never erase updates that arrived over SSE while sending. */
export function acknowledgeSessionInput(
  queryClient: QueryClient,
  sessionId: string,
  clientMessageId: string,
  eventId: number,
  optimisticEventId?: number,
  deliveryStatus: 'accepted' | 'queued' = 'accepted',
): void {
  queryClient.setQueryData<SessionEventRow[]>(sessionKeys.events(sessionId), (old = []) => {
    const existing = old.find((event) => event.id === eventId);
    const optimistic = old.find(
      (event) =>
        event.type === 'text' &&
        (event.data.clientMessageId === clientMessageId || event.id === optimisticEventId),
    );
    const accepted =
      existing ??
      (optimistic?.type === 'text'
        ? {
            ...optimistic,
            id: eventId,
            data: { ...optimistic.data, clientMessageId, deliveryStatus },
          }
        : undefined);
    const remaining = old.filter(
      (event) =>
        event.id !== eventId &&
        !(
          event.type === 'text' &&
          (event.data.clientMessageId === clientMessageId || event.id === optimisticEventId)
        ),
    );
    if (accepted) remaining.push(accepted);
    return remaining.sort((a, b) =>
      a.id < 0 || b.id < 0 ? (a.id < 0 ? (b.id < 0 ? b.id - a.id : 1) : -1) : a.id - b.id,
    );
  });
}

export function updateOptimisticDelivery(
  queryClient: QueryClient,
  sessionId: string,
  eventId: number,
  status: DeliveryStatus,
  error?: string,
): void {
  queryClient.setQueryData<SessionEventRow[]>(sessionKeys.events(sessionId), (old = []) =>
    old.map((event) =>
      event.id === eventId && event.type === 'text'
        ? {
            ...event,
            data: {
              ...event.data,
              deliveryStatus: status,
              deliveryError: error,
            },
          }
        : event,
    ),
  );
}

export async function sendSessionInput(
  sessionId: string,
  input: string,
  attachmentIds?: string[],
  clientMessageId?: string,
): Promise<number> {
  const response = await api.sendInput({
    params: { id: sessionId },
    body: {
      input,
      ...(clientMessageId ? { clientMessageId } : {}),
      ...(attachmentIds && attachmentIds.length > 0 ? { attachmentIds } : {}),
    },
  });
  if (response.status === 200) return response.body.eventId;
  const body = response.body;
  if (body && typeof body === 'object' && 'message' in body && typeof body.message === 'string') {
    throw new Error(body.message);
  }
  throw new Error('Session did not accept the message');
}
