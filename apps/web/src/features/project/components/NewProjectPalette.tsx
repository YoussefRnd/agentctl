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
    <div className="bg-background animate-fade-in-up relative flex flex-1 flex-col items-center justify-center overflow-hidden p-8">
      <div className="bg-accent-glow/20 animate-pulse-slow pointer-events-none absolute top-1/2 left-1/2 h-[800px] w-[800px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-40 blur-[150px]" />
      <div className="relative z-10 flex w-full max-w-2xl flex-col items-center space-y-8">
        {mutation.isPending ? (
          <div className="flex flex-col items-center gap-6">
            <Sparkles className="text-accent h-12 w-12 animate-pulse" />
            <p className="text-text-main text-2xl font-black tracking-tight">
              Setting up your workspace...
            </p>
            <p className="text-text-muted">Opening the project and preparing a session</p>
          </div>
        ) : (
          <>
            <h1 className="font-display from-text-main to-text-muted bg-gradient-to-br bg-clip-text text-4xl font-bold tracking-tight text-transparent">
              What are we building today?
            </h1>
            <p className="text-text-muted mb-12 text-lg">
              {shouldShowExplorer
                ? 'Pick a Git project folder and start collaborating with your agents.'
                : 'Select a project from the sidebar to continue, or open a new one.'}
            </p>

            {mutation.error && (
              <div className="border-danger/30 bg-danger/10 text-text-main mb-6 rounded-xl border p-4 text-left text-sm">
                <div className="text-danger flex items-center gap-2 font-bold">
                  <AlertCircle className="h-4 w-4" />
                  Could not open project
                </div>
                <p className="text-text-muted mt-1">{mutation.error.message}</p>
              </div>
            )}

            {shouldShowExplorer ? (
              <DirectoryExplorer onSelect={handleFolderSelect} />
            ) : (
              <button
                onClick={() => {
                  setShowExplorer(true);
                }}
                className="bg-surface-secondary/80 shadow-immersive-lg hover:bg-surface-hover hover:border-accent/50 text-text-main rounded-2xl border border-white/10 px-6 py-3 font-medium backdrop-blur-xl transition-all duration-300"
              >
                Open New Project
              </button>
            )}
          </>
        )}
      </div>
      <div className="bg-accent/5 pointer-events-none absolute top-1/2 left-1/2 -z-0 h-[1000px] w-[1000px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-50 blur-[150px]" />
    </div>
  );
}
