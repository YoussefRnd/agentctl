import { useCallback } from 'react';
import { openInEditor } from '@agentctl/api-client';
import { toast } from 'sonner';
import { useSession } from './SessionConfigContext';

export function useOpenWorkspaceFile() {
  const { sessionData } = useSession();
  const worktreePath = sessionData?.session.worktreePath;

  return useCallback(
    async (filePath: string) => {
      if (!worktreePath) return;

      const preferredEditor = localStorage.getItem('agentctl:preferred-editor') ?? 'cursor';
      const separator = worktreePath.endsWith('/') || worktreePath.endsWith('\\') ? '' : '/';

      try {
        await openInEditor(preferredEditor, `${worktreePath}${separator}${filePath}`);
        toast.success(`Opened ${filePath.split('/').pop() ?? filePath}`);
      } catch {
        toast.error('Could not open file in editor');
      }
    },
    [worktreePath],
  );
}
