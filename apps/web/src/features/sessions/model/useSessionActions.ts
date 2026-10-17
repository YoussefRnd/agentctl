import { projectKeys } from '@/shared/lib/queryKeys';
import { useSession, useSessionQueue } from './SessionContext';
import { api, type SidebarProject } from '@agentctl/api-client';
import {
  nextOptimisticEventId,
  sendSessionInput,
  updateOptimisticDelivery,
  acknowledgeSessionInput,
} from './messageDelivery';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useMessageQueueStore } from '@/shared/stores/useMessageQueueStore';
import { sessionKeys } from '@/shared/lib/queryKeys';
import type { SessionEventRow, SessionExecution, SessionWithCapabilities } from '@agentctl/shared';
import {
  acceptPromptPerformance,
  beginPromptPerformance,
  cancelPromptPerformance,
} from '@/shared/lib/promptPerformance';

export function useSessionActions() {
  const { sessionId, sessionData } = useSession();
  const { retryMessage: handleRetry } = useSessionQueue();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const handleSend = async (text: string, attachmentIds?: string[]) => {
    if (text.trim().toLowerCase() === '/mcp') {
      void navigate('/settings?tab=mcp');
      return;
    }

    if (!text.trim() && (!attachmentIds || attachmentIds.length === 0)) return;

    const currentSession =
      queryClient.getQueryData<SessionWithCapabilities>(sessionKeys.detail(sessionId)) ??
      sessionData;
    const execution = queryClient.getQueryData<SessionExecution>(sessionKeys.execution(sessionId));
    const isWaiting =
      currentSession?.session.status === 'running' ||
      currentSession?.session.status === 'error' ||
      !!execution?.queue.length ||
      execution?.attention === 'delivery_uncertain';
    const tempId = nextOptimisticEventId();
    const clientMessageId = crypto.randomUUID();
    if (!isWaiting) beginPromptPerformance(sessionId, clientMessageId);
    const optimisticEvent: SessionEventRow = {
      id: tempId,
      sessionId: sessionId,
      type: 'text',
      data: {
        role: 'user',
        content: text,
        clientMessageId,
        deliveryStatus: isWaiting ? 'queued' : 'sending',
        attachmentIds,
      },
      createdAt: new Date(),
    };

    queryClient.setQueryData<SessionEventRow[]>(sessionKeys.events(sessionId), (old = []) => {
      return [...old, optimisticEvent];
    });

    {
      useMessageQueueStore
        .getState()
        .enqueueMessage(
          sessionId,
          text,
          attachmentIds,
          tempId,
          clientMessageId,
          'sending',
          isWaiting,
        );
      if (!isWaiting)
        queryClient.setQueryData<SessionWithCapabilities>(
          sessionKeys.detail(sessionId),
          (old: SessionWithCapabilities | undefined) => {
            if (!old) return old;
            return {
              ...old,
              session: {
                ...old.session,
                status: 'running',
                updatedAt: new Date(),
              },
            };
          },
        );

      // Optimistically update projects query in cache
      queryClient.setQueriesData<SidebarProject[]>({ queryKey: projectKeys.all }, (old) => {
        if (!old) return old;
        return old.map((p) => ({
          ...p,
          sessions: p.sessions.map((s) =>
            s.id === sessionId
              ? {
                  ...s,
                  status: isWaiting ? (currentSession?.session.status ?? s.status) : 'running',
                  updatedAt: new Date(),
                  lastActivityAt: optimisticEvent.createdAt,
                }
              : s,
          ),
        }));
      });

      try {
        const acceptedId = await sendSessionInput(sessionId, text, attachmentIds, clientMessageId);
        if (!isWaiting) acceptPromptPerformance(sessionId, acceptedId, clientMessageId);
        useMessageQueueStore.getState().dequeueMessage(sessionId, clientMessageId);
        acknowledgeSessionInput(
          queryClient,
          sessionId,
          clientMessageId,
          acceptedId,
          tempId,
          isWaiting ? 'queued' : 'accepted',
        );
        void queryClient.invalidateQueries({ queryKey: sessionKeys.execution(sessionId) });
        void queryClient.invalidateQueries({ queryKey: projectKeys.all });
        return true;
      } catch (error) {
        const persisted = queryClient
          .getQueryData<SessionEventRow[]>(sessionKeys.events(sessionId))
          ?.find(
            (event) =>
              event.id > 0 &&
              event.type === 'text' &&
              event.data.clientMessageId === clientMessageId,
          );
        if (persisted) {
          useMessageQueueStore.getState().dequeueMessage(sessionId, clientMessageId);
          void queryClient.invalidateQueries({ queryKey: sessionKeys.execution(sessionId) });
          return true;
        }
        if (!isWaiting) cancelPromptPerformance(sessionId);
        const message = error instanceof Error ? error.message : 'Message was not accepted';
        useMessageQueueStore
          .getState()
          .setMessageStatus(sessionId, clientMessageId, 'failed', message);
        updateOptimisticDelivery(queryClient, sessionId, tempId, 'failed', message);
        queryClient.setQueryData<SessionWithCapabilities>(
          sessionKeys.detail(sessionId),
          (old: SessionWithCapabilities | undefined) => {
            if (!old || isWaiting) return old;
            return {
              ...old,
              session: {
                ...old.session,
                status: 'idle',
              },
            };
          },
        );
        void queryClient.invalidateQueries({ queryKey: projectKeys.all });
        void queryClient.invalidateQueries({ queryKey: sessionKeys.detail(sessionId) });
        toast.error('Failed to send message', {
          description: message,
          action: {
            label: 'Retry',
            onClick: () => handleRetry(tempId),
          },
        });
        return false;
      }
    }
  };

  const handleApprove = (eventId: number, optionId?: string) => {
    void api
      .approveEvent({
        params: { id: sessionId },
        body: { eventId, optionId },
      })
      .then(() => {
        void queryClient.invalidateQueries({ queryKey: projectKeys.all });
        void queryClient.invalidateQueries({ queryKey: sessionKeys.detail(sessionId) });
      })
      .catch((err: unknown) => {
        toast.error(err instanceof Error ? err.message : 'Failed to respond to approval');
      });
  };

  const handleDeny = (eventId: number) => {
    void api
      .denyEvent({
        params: { id: sessionId },
        body: { eventId },
      })
      .then(() => {
        void queryClient.invalidateQueries({ queryKey: projectKeys.all });
        void queryClient.invalidateQueries({ queryKey: sessionKeys.detail(sessionId) });
      })
      .catch((err: unknown) => {
        toast.error(err instanceof Error ? err.message : 'Failed to respond to approval');
      });
  };

  const handleCancel = () => {
    void api
      .cancelSession({
        params: { id: sessionId },
        body: {},
      })
      .then(() => {
        void queryClient.invalidateQueries({ queryKey: projectKeys.all });
        void queryClient.invalidateQueries({ queryKey: sessionKeys.detail(sessionId) });
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Failed to stop agent';
        toast.error(message);
      });
  };

  return {
    handleSend,
    handleRetry,
    handleApprove,
    handleDeny,
    handleCancel,
  };
}
