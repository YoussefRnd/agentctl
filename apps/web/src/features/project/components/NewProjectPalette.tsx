import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DirectoryExplorer } from './DirectoryExplorer';
import { AlertCircle, Loader2 } from 'lucide-react';
import { apiClient, openProjectSession, type SidebarProject } from '@agentctl/api-client';
import { Button } from '@agentctl/ui';

export function NewProjectPalette() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiClient.fetch<SidebarProject[]>('/api/projects'),
  });

  const mutation = useMutation({
    mutationFn: (path: string) => openProjectSession(path),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      void navigate(`/sessions/${data.session.id}`);
    },
  });

  const handleFolderSelect = (path: string) => {
    mutation.mutate(path);
  };

  const [showExplorer, setShowExplorer] = useState(false);

  const shouldShowExplorer = projects.length === 0 || showExplorer;

  return (
    <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden bg-transparent p-4">
      <div className="relative z-10 flex w-full max-w-2xl flex-col items-center space-y-4">
        {mutation.isPending ? (
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="text-accent h-8 w-8 animate-spin" />
            <p className="text-text-main text-xl font-black tracking-widest uppercase">
              INITIALIZING_WORKSPACE...
            </p>
            <p className="text-text-muted text-[11px] font-bold uppercase">
              PREPARING_SESSION_CONTEXT
            </p>
          </div>
        ) : (
          <>
            <h1 className="text-text-main text-center text-3xl font-black tracking-widest uppercase">
              AGENTCTL::START_COLLABORATION
            </h1>
            <p className="text-text-muted mb-8 max-w-md text-center text-[12px] font-bold tracking-tight uppercase">
              {shouldShowExplorer
                ? 'SELECT_GIT_PROJECT_DIRECTORY_TO_BEGIN_TASK_ORCHESTRATION.'
                : 'CHOOSE_ACTIVE_PROJECT_FROM_SIDEBAR_OR_OPEN_NEW_DIRECTORY.'}
            </p>

            {mutation.error && (
              <div className="border-danger/30 bg-danger/5 text-danger mb-4 rounded-md border p-3 text-left text-[11px]">
                <div className="flex items-center gap-2 font-black uppercase">
                  <AlertCircle className="h-3.5 w-3.5" />
                  ERROR::MOUNT_FAILED
                </div>
                <p className="text-danger/80 mt-1 font-bold uppercase opacity-80">
                  {mutation.error.message}
                </p>
              </div>
            )}

            {shouldShowExplorer ? (
              <DirectoryExplorer onSelect={handleFolderSelect} />
            ) : (
              <Button
                onClick={() => {
                  setShowExplorer(true);
                }}
                className="h-10 px-6 text-[13px] font-bold tracking-widest uppercase"
              >
                OPEN_NEW_PROJECT
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
