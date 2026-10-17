import { projectKeys } from '@/shared/lib/queryKeys';
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { SessionWithCapabilities } from '@agentctl/shared';
import { invalidateWorkspaceQueries } from '@/shared/lib/workspaceQueries';
import { sendDesktopNotification } from '@/shared/lib/notifications';

export function useSessionStatusEffects(
  sessionId: string,
  sessionData: SessionWithCapabilities | undefined,
) {
  const queryClient = useQueryClient();
  const prevStatusRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const currentStatus = sessionData?.session.status;
    const prevStatus = prevStatusRef.current;

    if (prevStatus !== undefined && currentStatus && prevStatus !== currentStatus) {
      if (prevStatus === 'running' && currentStatus === 'idle') {
        sendDesktopNotification({
          title: 'AgentCtl · Task Complete',
          body: sessionData?.session.title || 'Task finished successfully',
          sessionId,
          type: 'completion',
        });
      } else if (currentStatus === 'needs_attention') {
        sendDesktopNotification({
          title: 'AgentCtl · Approval Required',
          body: `${sessionData?.session.title || 'Session'} is waiting for your review`,
          sessionId,
          type: 'attention',
        });
      }
    }

    prevStatusRef.current = currentStatus;
  }, [sessionData?.session.status, sessionData?.session.title, sessionId]);

  useEffect(() => {
    if (
      sessionData?.session.status === 'idle' ||
      sessionData?.session.status === 'needs_attention' ||
      sessionData?.session.status === 'running'
    ) {
      invalidateWorkspaceQueries(queryClient, sessionId, 'files');
      void queryClient.invalidateQueries({ queryKey: projectKeys.all });
    }
  }, [sessionData?.session.status, sessionId, queryClient]);
}
