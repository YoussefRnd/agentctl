import { useSession, useSessionStream } from '../contexts/SessionContext';
import { api } from '@agentctl/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import type { ACPEventRow, SessionWithCapabilities } from '@agentctl/shared';

export function useSessionActions() {
  const { sessionId, sessionData } = useSession();
  const { enqueueMessage } = useSessionStream();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const handleSend = async (text: string, attachmentIds?: string[]) => {
    if (text.trim().toLowerCase() === '/mcp') {
      void navigate('/settings?tab=mcp');
      return;
    }

    if (!text.trim() && (!attachmentIds || attachmentIds.length === 0)) return;

    const tempId = -Date.now();
    const optimisticEvent: ACPEventRow = {
      id: tempId,
      sessionId: sessionId,
      type: 'text',
      data: {
        role: 'user',
        content: text,
      },
      createdAt: new Date(),
    };

    queryClient.setQueryData<ACPEventRow[]>(['events', sessionId], (old = []) => {
      return [...old, optimisticEvent];
    });

    const isRunning = sessionData?.session.status === 'running';
    if (isRunning) {
      enqueueMessage(text, attachmentIds);
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
            },
          };
        },
      );

      try {
        await api.sendInput({
          params: { id: sessionId },
          body: {
            input: text,
            ...(attachmentIds && attachmentIds.length > 0 ? { attachmentIds } : {}),
          },
        });
      } catch {
        queryClient.setQueryData<ACPEventRow[]>(['events', sessionId], (old = []) => {
          return old.filter((e) => e.id !== tempId);
        });
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
        toast.error('Failed to send message');
      }
    }
  };

  const handleApprove = (eventId: number, optionId?: string) => {
    void api.approveEvent({
      params: { id: sessionId },
      body: { eventId, optionId },
    });
  };

  const handleDeny = (eventId: number) => {
    void api.denyEvent({
      params: { id: sessionId },
      body: { eventId },
    });
  };

  const handleCancel = () => {
    void api.cancelSession({
      params: { id: sessionId },
      body: {},
    });
  };

  return {
    handleSend,
    handleApprove,
    handleDeny,
    handleCancel,
  };
}
