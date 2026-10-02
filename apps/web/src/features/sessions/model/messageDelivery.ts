import type { QueryClient } from '@tanstack/react-query';
import type { SessionEventRow } from '@agentctl/shared';
import { api } from '@agentctl/api-client';
import { sessionKeys } from '@/shared/lib/queryKeys';

type DeliveryStatus = 'queued' | 'sending' | 'accepted' | 'failed';
let lastOptimisticId = 0;

export function nextOptimisticEventId(): number {
  lastOptimisticId = Math.min(lastOptimisticId - 1, -Date.now());
  return lastOptimisticId;
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
