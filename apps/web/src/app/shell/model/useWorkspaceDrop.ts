import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { openProjectFolder, type SidebarProject } from '@agentctl/api-client';
import { toast } from 'sonner';
import { projectKeys } from '@/shared/lib/queryKeys';
import { resolveDroppedWorkspace } from './droppedWorkspace';

/** Owns sidebar drop feedback and the open/invalidate/navigate workflow. */
export function useWorkspaceDrop(projects: SidebarProject[]) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [isDraggingOverSidebar, setIsDraggingOverSidebar] = useState(false);
  const dragCounter = useRef(0);

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    const types = Array.from(e.dataTransfer?.types || []);
    if (types.includes('Files') || types.includes('text/uri-list')) {
      dragCounter.current += 1;
      if (dragCounter.current === 1) {
        setIsDraggingOverSidebar(true);
      }
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) {
      setIsDraggingOverSidebar(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDraggingOverSidebar(false);

    const { pathToOpen, resolvedPath } = resolveDroppedWorkspace(
      e.dataTransfer,
      projects,
      window.electronAPI?.getPathForFile,
    );
    if (!pathToOpen) {
      toast.error('Unable to determine folder path');
      return;
    }

    try {
      const project = await openProjectFolder(pathToOpen);
      await queryClient.invalidateQueries({ queryKey: projectKeys.all });
      void navigate(`/?project=${encodeURIComponent(project.id)}`);
      toast.success('Workspace opened');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to open workspace';
      toast.error(msg);
      if (!resolvedPath) {
        void navigate('/');
      }
    }
  };

  return { isDraggingOverSidebar, handleDragEnter, handleDragOver, handleDragLeave, handleDrop };
}
