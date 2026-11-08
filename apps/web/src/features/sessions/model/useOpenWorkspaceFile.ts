import { useCallback } from 'react';
import { toast } from 'sonner';
import { launchEditor, useEditorPreference } from '@/shared/editors/useEditorPreference';
import { useSession } from './SessionConfigContext';

export function useOpenWorkspaceFile() {
  const { sessionData } = useSession();
  const worktreePath = sessionData?.session.worktreePath;
  const { activeEditor } = useEditorPreference(!!worktreePath);

  return useCallback(
    async (filePath: string) => {
      if (!worktreePath) return;

      const separator = worktreePath.endsWith('/') || worktreePath.endsWith('\\') ? '' : '/';

      try {
        const result = await launchEditor(
          activeEditor.id,
          `${worktreePath}${separator}${filePath}`,
        );
        const name = filePath.split('/').pop() ?? filePath;
        toast.success(result === 'browser' ? `Opening ${name}…` : `Opened ${name}`);
      } catch {
        toast.error('Could not open file in editor');
      }
    },
    [activeEditor.id, worktreePath],
  );
}
