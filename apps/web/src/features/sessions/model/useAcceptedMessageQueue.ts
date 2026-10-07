import { useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@agentctl/api-client';
import { toast } from 'sonner';
import type { QueuedMessage } from '@/shared/stores/useMessageQueueStore';

/** The browser outbox owns unacknowledged sends; accepted order belongs to the server. */
export function useAcceptedMessageQueue(sessionId: string) {
  const client = useQueryClient();
  const queryKey = useMemo(() => ['session-execution', sessionId], [sessionId]);
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
  const changeMessage = useCallback(
    async (id: string, action: 'cancel' | 'up' | 'down') => {
      try {
        const response = await api.changeQueuedMessage({
          params: { id: sessionId, commandId: id },
          body: { action },
        });
        if (response.status !== 200)
          throw new Error(
            response.status === 409 ? response.body.message : 'Could not update the queue',
          );
        await client.invalidateQueries({ queryKey });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Could not update the queue');
      }
    },
    [client, queryKey, sessionId],
  );
  const resume = useCallback(async () => {
    try {
      const response = await api.resumeSessionQueue({ params: { id: sessionId }, body: {} });
      if (response.status !== 200)
        throw new Error(
          response.status === 409 ? response.body.message : 'Could not resume the queue',
        );
      await client.invalidateQueries({ queryKey });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not resume the queue');
    }
  }, [client, queryKey, sessionId]);
  return useMemo(
    () => ({ queuedMessages, changeMessage, resume, execution: query.data }),
    [queuedMessages, changeMessage, resume, query.data],
  );
}
