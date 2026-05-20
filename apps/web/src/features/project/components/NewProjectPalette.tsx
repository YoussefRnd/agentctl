import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DirectoryExplorer } from './DirectoryExplorer';
import { AlertCircle, Sparkles } from 'lucide-react';
import type { DriverDiscovery } from '@agentctl/shared';
import { apiClient, openProjectSession, type SidebarProject } from '@agentctl/api-client';

export function NewProjectPalette() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: drivers = [] } = useQuery({
    queryKey: ['drivers'],
    queryFn: () => apiClient.fetch<DriverDiscovery[]>('/api/drivers'),
  });

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiClient.fetch<SidebarProject[]>('/api/projects'),
  });

  const mutation = useMutation({
    mutationFn: (path: string) => openProjectSession(path, drivers),
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
    <div className="flex-1 flex flex-col items-center justify-center p-8 bg-background relative overflow-hidden">
      <div className="max-w-2xl w-full text-center animate-in fade-in zoom-in-95 duration-1000 relative z-10">
        {mutation.isPending ? (
          <div className="flex flex-col items-center gap-6">
            <Sparkles className="w-12 h-12 text-accent animate-pulse" />
            <p className="text-2xl font-black tracking-tight text-text-main">
              Setting up your workspace...
            </p>
            <p className="text-text-muted">Opening the project and preparing a session</p>
          </div>
        ) : (
          <>
            <h1 className="text-5xl font-black mb-4 tracking-tight text-text-main">
              Welcome to Agent Workbench!
            </h1>
            <p className="text-text-muted text-lg mb-12">
              {shouldShowExplorer
                ? 'Pick a Git project folder and start collaborating with your agents.'
                : 'Select a project from the sidebar to continue, or open a new one.'}
            </p>

            {mutation.error && (
              <div className="mb-6 rounded-xl border border-danger/30 bg-danger/10 p-4 text-left text-sm text-text-main">
                <div className="flex items-center gap-2 font-bold text-danger">
                  <AlertCircle className="h-4 w-4" />
                  Could not open project
                </div>
                <p className="mt-1 text-text-muted">{mutation.error.message}</p>
              </div>
            )}

            {shouldShowExplorer ? (
              <DirectoryExplorer onSelect={handleFolderSelect} />
            ) : (
              <button
                onClick={() => {
                  setShowExplorer(true);
                }}
                className="px-6 py-3 bg-surface hover:bg-surface-hover border border-border text-text-main rounded-xl font-medium transition-colors"
              >
                Open New Project
              </button>
            )}
          </>
        )}
      </div>
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1000px] h-[1000px] bg-accent/5 rounded-full blur-[150px] -z-0 pointer-events-none opacity-50" />
    </div>
  );
}
