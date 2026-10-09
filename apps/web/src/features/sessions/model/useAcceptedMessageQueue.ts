import { useMemo, useCallback, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@agentctl/api-client';
import { toast } from 'sonner';
import type { QueuedMessage } from '@/shared/stores/useMessageQueueStore';
import { sessionKeys } from '@/shared/lib/queryKeys';

/** The browser outbox owns unacknowledged sends; accepted order belongs to the server. */
export function useAcceptedMessageQueue(sessionId: string) {
  const client = useQueryClient();
  const queryKey = useMemo(() => ['session-execution', sessionId], [sessionId]);
  const pendingRef = useRef<{ sessionId: string; id: string } | null>(null);
  const [pending, setPending] = useState<typeof pendingRef.current>(null);
  const query = useQuery({
    queryKey,
    enabled: !!sessionId,
    queryFn: async () => {
      const response = await api.getSessionExecution({ params: { id: sessionId } });
      if (response.status !== 200) throw new Error('Could not load the accepted message queue');
      return response.body;
    },
    refetchInterval: 2000,
  });
  const queuedMessages = useMemo<QueuedMessage[]>(
    () => (query.data?.queue ?? []).map((message) => ({ ...message, accepted: true })),
    [query.data?.queue],
  );
  const perform = useCallback(
    async (id: string, request: () => Promise<{ status: number; body: unknown }>) => {
      if (pendingRef.current?.sessionId === sessionId) return false;
      const operation = { sessionId, id };
      pendingRef.current = operation;
      setPending(operation);
      try {
        await client.cancelQueries({ queryKey });
        const response = await request();
        if (response.status !== 200) {
          const body = response.body;
          throw new Error(
            body &&
              typeof body === 'object' &&
              'message' in body &&
              typeof body.message === 'string'
              ? body.message
              : 'Could not update the queue',
          );
        }
        return true;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Could not update the queue');
        return false;
      } finally {
        // Conflicts often mean the message was dispatched while the user acted.
        await Promise.all([
          client.invalidateQueries({ queryKey }),
          client.invalidateQueries({ queryKey: sessionKeys.events(sessionId) }),
          client.invalidateQueries({ queryKey: sessionKeys.detail(sessionId) }),
        ]);
        if (pendingRef.current === operation) {
          pendingRef.current = null;
          setPending(null);
        }
      }
    },
    [client, queryKey, sessionId],
  );
  const changeMessage = useCallback(
    (id: string, action: 'cancel' | 'up' | 'down' | 'edit', input?: string) =>
      perform(id, () =>
        api.changeQueuedMessage({
          params: { id: sessionId, commandId: id },
          body: action === 'edit' ? { action, input: input ?? '' } : { action },
        }),
      ),
    [perform, sessionId],
  );
  const resume = useCallback(
    () => perform('resume', () => api.resumeSessionQueue({ params: { id: sessionId }, body: {} })),
    [perform, sessionId],
  );
  const pendingId = pending?.sessionId === sessionId ? pending.id : undefined;
  return useMemo(
    () => ({ queuedMessages, changeMessage, resume, execution: query.data, pendingId }),
    [queuedMessages, changeMessage, resume, query.data, pendingId],
  );
}
