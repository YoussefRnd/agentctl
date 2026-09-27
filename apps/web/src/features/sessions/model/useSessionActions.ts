import { useSession, useSessionStream } from './SessionContext';
import { api, type SidebarProject } from '@agentctl/api-client';
import {
  nextOptimisticEventId,
  sendSessionInput,
  updateOptimisticDelivery,
} from './messageDelivery';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { sessionKeys } from '@/shared/lib/queryKeys';
import type { SessionEventRow, SessionWithCapabilities } from '@agentctl/shared';

export function useSessionActions() {
  const { sessionId, sessionData } = useSession();
  const { enqueueMessage, retryMessage: handleRetry } = useSessionStream();
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
    const isRunning = currentSession?.session.status === 'running';
    const tempId = nextOptimisticEventId();
    const optimisticEvent: SessionEventRow = {
      id: tempId,
      sessionId: sessionId,
      type: 'text',
      data: {
        role: 'user',
        content: text,
        deliveryStatus: isRunning ? 'queued' : 'sending',
        attachmentIds,
      },
      createdAt: new Date(),
    };

    queryClient.setQueryData<SessionEventRow[]>(['events', sessionId], (old = []) => {
      return [...old, optimisticEvent];
    });

    if (isRunning) {
      enqueueMessage(text, attachmentIds, tempId);
    } else {
      queryClient.setQueryData<SessionWithCapabilities>(
        ['session', sessionId],
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
      queryClient.setQueriesData<SidebarProject[]>({ queryKey: ['projects'] }, (old) => {
        if (!old) return old;
        return old.map((p) => ({
          ...p,
          sessions: p.sessions.map((s) =>
            s.id === sessionId
              ? {
                  ...s,
                  status: 'running',
                  updatedAt: new Date(),
                  lastActivityAt: optimisticEvent.createdAt,
                }
              : s,
          ),
        }));
      });

      try {
        await sendSessionInput(sessionId, text, attachmentIds);
        updateOptimisticDelivery(queryClient, sessionId, tempId, 'accepted');
        void queryClient.invalidateQueries({ queryKey: ['projects'] });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Message was not accepted';
        updateOptimisticDelivery(queryClient, sessionId, tempId, 'failed', message);
        queryClient.setQueryData<SessionWithCapabilities>(
          ['session', sessionId],
          (old: SessionWithCapabilities | undefined) => {
            if (!old) return old;
            return {
              ...old,
              session: {
                ...old.session,
                status: 'idle',
              },
            };
          },
        );
        void queryClient.invalidateQueries({ queryKey: ['projects'] });
        void queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
        toast.error('Failed to send message', {
          description: message,
          action: {
            label: 'Retry',
            onClick: () => handleRetry(tempId),
          },
        });
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
        void queryClient.invalidateQueries({ queryKey: ['projects'] });
        void queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
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
        void queryClient.invalidateQueries({ queryKey: ['projects'] });
        void queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
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
        void queryClient.invalidateQueries({ queryKey: ['projects'] });
        void queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
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
