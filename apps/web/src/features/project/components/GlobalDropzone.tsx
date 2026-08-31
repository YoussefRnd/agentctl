import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { FolderUp, Sparkles, AlertCircle } from 'lucide-react';
import { openProjectSession } from '@agentctl/api-client';

export function GlobalDropzone() {
  const [isDragging, setIsDragging] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const dragCounter = useRef(0);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => {
    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault();
      // Check if drag contains files
      if (e.dataTransfer?.types && Array.from(e.dataTransfer.types).includes('Files')) {
        dragCounter.current += 1;
        if (dragCounter.current === 1) {
          setIsDragging(true);
          setErrorMessage(null);
        }
      }
    };

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
      }
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current = Math.max(0, dragCounter.current - 1);
      if (dragCounter.current === 0) {
        setIsDragging(false);
      }
    };

    const handleDrop = async (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current = 0;
      setIsDragging(false);

      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;

      const firstFile = files[0];
      if (!firstFile) return;

      // Resolve absolute path
      let resolvedPath: string | undefined = undefined;

      if (window.electronAPI?.getPathForFile) {
        try {
          resolvedPath = window.electronAPI.getPathForFile(firstFile);
        } catch {
          // fallback
        }
      }

      if (
        !resolvedPath &&
        'path' in firstFile &&
        typeof (firstFile as { path?: string }).path === 'string'
      ) {
        resolvedPath = (firstFile as { path?: string }).path;
      }

      if (!resolvedPath) {
        setErrorMessage(
          'Unable to determine folder path. Please select folder via the Add Workspace dialog.',
        );
        setTimeout(() => {
          setErrorMessage(null);
        }, 4000);
        return;
      }

      setIsImporting(true);
      try {
        const res = await openProjectSession(resolvedPath);
        if (res?.session?.id) {
          await queryClient.invalidateQueries({ queryKey: ['projects'] });
          void navigate(`/sessions/${res.session.id}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to import workspace';
        setErrorMessage(msg);
        setTimeout(() => {
          setErrorMessage(null);
        }, 5000);
      } finally {
        setIsImporting(false);
      }
    };

    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
    };
  }, [navigate, queryClient]);

  if (!isDragging && !isImporting && !errorMessage) return null;

  return (
    <div
      aria-live="polite"
      className="bg-background/80 pointer-events-none fixed inset-0 z-50 flex items-center justify-center backdrop-blur-md transition-all duration-200"
    >
      <div className="bg-surface-elevated/95 border-accent/60 shadow-accent/10 animate-in fade-in-50 zoom-in-95 flex max-w-lg flex-col items-center justify-center gap-4 rounded-3xl border-2 border-dashed p-10 text-center shadow-2xl">
        {errorMessage ? (
          <>
            <div className="bg-danger/10 text-danger flex h-16 w-16 items-center justify-center rounded-2xl">
              <AlertCircle className="h-8 w-8" />
            </div>
            <div className="space-y-1">
              <h3 className="text-text-main text-lg font-semibold tracking-tight">Import Error</h3>
              <p className="text-text-muted text-xs">{errorMessage}</p>
            </div>
          </>
        ) : (
          <>
            <div className="bg-accent/10 text-accent flex h-16 w-16 items-center justify-center rounded-2xl shadow-inner">
              <FolderUp className="h-8 w-8 animate-bounce" />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-text-main flex items-center justify-center gap-2 text-xl font-bold tracking-tight">
                <Sparkles className="text-accent h-5 w-5" />
                {isImporting ? 'Opening Workspace...' : 'Drop Folder to Open Workspace'}
              </h3>
              <p className="text-text-muted max-w-sm text-xs leading-relaxed">
                Release anywhere to register this folder as a project and immediately start a new
                session.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
