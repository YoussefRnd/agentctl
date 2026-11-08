import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { archiveSession, deleteSession, renameSession, rewindSession } from '@agentctl/api-client';
import { projectKeys, sessionKeys } from '@/shared/lib/queryKeys';
import { useProjectExpansionStore } from '@/shared/stores/useProjectExpansionStore';

export function useSessionLifecycle(activeSessionId?: string) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const keepProjectExpanded = useProjectExpansionStore((state) => state.keepProjectExpanded);

  const refreshProjects = () => void client.invalidateQueries({ queryKey: projectKeys.all });
  const refreshSession = (sessionId: string) => {
    refreshProjects();
    void client.invalidateQueries({ queryKey: sessionKeys.detail(sessionId) });
  };

  return {
    async rename(sessionId: string, title: string) {
      await renameSession(sessionId, title.trim());
      refreshSession(sessionId);
    },
    async archive(sessionId: string) {
      await archiveSession(sessionId);
      refreshSession(sessionId);
    },
    async remove(sessionId: string, projectId?: string) {
      await deleteSession(sessionId);
      if (activeSessionId === sessionId && projectId) keepProjectExpanded(projectId);
      refreshProjects();
      if (activeSessionId === sessionId) void navigate('/');
    },
    async forkLatest(sessionId: string) {
      // Rewind includes every event through the supplied ID. SQLite event IDs reach JavaScript as numbers.
      const { forkSessionId } = await rewindSession(sessionId, Number.MAX_SAFE_INTEGER, 'fork');
      refreshProjects();
      if (forkSessionId) void navigate(`/sessions/${forkSessionId}`);
    },
  };
}
