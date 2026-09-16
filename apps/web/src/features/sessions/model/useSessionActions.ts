import { useSession, useSessionStream } from './SessionContext';
import { api, type SidebarProject } from '@agentctl/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import type { SessionEventRow, SessionWithCapabilities } from '@agentctl/shared';

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
    const optimisticEvent: SessionEventRow = {
      id: tempId,
      sessionId: sessionId,
      type: 'text',
      data: {
        role: 'user',
        content: text,
      },
      createdAt: new Date(),
    };

    queryClient.setQueryData<SessionEventRow[]>(['events', sessionId], (old = []) => {
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
        await api.sendInput({
          params: { id: sessionId },
          body: {
            input: text,
            ...(attachmentIds && attachmentIds.length > 0 ? { attachmentIds } : {}),
          },
        });
        void queryClient.invalidateQueries({ queryKey: ['projects'] });
      } catch {
        queryClient.setQueryData<SessionEventRow[]>(['events', sessionId], (old = []) => {
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
        void queryClient.invalidateQueries({ queryKey: ['projects'] });
        toast.error('Failed to send message');
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
    handleApprove,
    handleDeny,
    handleCancel,
  };
}
