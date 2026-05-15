import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useDirectoryPicker } from '../hooks/useDirectoryPicker.js';
import { apiClient } from '../lib/api-client.js';
import type { DriverDiscovery } from '@agentctl/shared';

interface CreateProjectResponse {
  project: { id: string; name: string; path: string };
}

interface CreateSessionResponse {
  id: string;
}

export function NewProjectPalette() {
  const navigate = useNavigate();
  const { pickDirectory } = useDirectoryPicker();
  const [projectPath, setProjectPath] = useState('');
  const [projectName, setProjectName] = useState('');
  const [step, setStep] = useState<'idle' | 'path' | 'provider'>('idle');

  const { data: drivers = [], isLoading: isLoadingDrivers } = useQuery({
    queryKey: ['drivers'],
    queryFn: () => apiClient.fetch<DriverDiscovery[]>('/api/drivers'),
  });

  const mutation = useMutation({
    mutationFn: async (payload: { path: string; selectedDriver: string }) => {
      // 1. Create the project record
      const { project } = await apiClient.fetch<CreateProjectResponse>('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ path: payload.path }),
      });

      // 2. Create and start the initial session
      return apiClient.fetch<CreateSessionResponse>('/api/sessions', {
        method: 'POST',
        body: JSON.stringify({
          projectId: project.id,
          agent: payload.selectedDriver,
          taskSlug: 'setup-project',
        }),
      });
    },
    onSuccess: (data) => {
      void navigate(`/sessions/${data.id}`);
    },
  });

  const deriveNameFromPath = (p: string) => {
    const parts = p.replace(/\/$/, '').split('/');
    return parts[parts.length - 1] || '';
  };

  const handleBrowse = useCallback(async () => {
    const name = await pickDirectory();
    if (name) {
      setProjectName(name);
    }
  }, [pickDirectory]);

  const handlePathChange = useCallback((value: string) => {
    setProjectPath(value);
    setProjectName(deriveNameFromPath(value));
  }, []);

  const handleNext = useCallback(() => {
    if (projectPath.trim()) {
      setStep('provider');
    }
  }, [projectPath]);

  const handleProviderSelect = useCallback((driverId: string) => {
    mutation.mutate({ path: projectPath, selectedDriver: driverId });
  }, [mutation, projectPath]);

  if (step === 'idle') {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center animate-in fade-in zoom-in duration-500">
        <div className="mb-6">
          <h2 className="text-xl font-bold mb-2">Welcome to Agent Workbench</h2>
          <p className="text-text-muted max-w-md mb-8 leading-relaxed">
            Start by creating a project.
          </p>
        </div>
        <button
          type="button"
          onClick={() => { setStep('path'); }}
          className="inline-flex items-center gap-2 rounded-xl bg-accent px-6 py-3 text-background font-semibold transition-colors hover:bg-accent-hover"
        >
          New project
        </button>
      </div>
    );
  }

  if (step === 'path') {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center animate-in fade-in slide-in-from-bottom-4 duration-300">
        <div className="mb-6">
          <h2 className="text-lg font-bold mb-1">Project Path</h2>
          <p className="text-sm text-text-muted">Enter the <strong>absolute path</strong> to your local repository.</p>
        </div>
        <div className="flex flex-col items-center gap-3 w-full max-w-sm">
          <div className="flex w-full items-center gap-2">
            <input
              type="text"
              value={projectPath}
              onChange={(e) => { handlePathChange(e.target.value); }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleNext(); }}
              placeholder="/home/user/myproject"
              className="flex-1 rounded-xl border border-border bg-surface px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <button
              type="button"
              onClick={() => { void handleBrowse(); }}
              className="rounded-xl border border-border bg-surface px-4 py-3 text-sm text-text-muted hover:text-text-main transition-colors"
            >
              Browse
            </button>
          </div>
          {projectName && (
            <p className="text-xs text-text-muted">
              Project name: <span className="font-medium text-text-main">{projectName}</span>
            </p>
          )}
          <button
            type="button"
            disabled={!projectPath.trim()}
            onClick={handleNext}
            className="mt-2 inline-flex items-center gap-2 rounded-xl bg-accent px-6 py-3 text-background font-semibold transition-colors hover:bg-accent-hover disabled:opacity-50 w-full justify-center"
          >
            Next
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center p-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="mb-4 text-center">
        <p className="text-sm text-text-muted mb-1">Project</p>
        <p className="text-lg font-bold">{projectName}</p>
      </div>
      <p className="text-sm text-text-muted mb-4">Choose a provider</p>
      <div className="flex flex-col gap-2 w-72">
        {isLoadingDrivers ? (
          <div className="py-8 flex justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          </div>
        ) : (
          drivers.map((d) => {
            const isReady = d.status === 'ready';
            const firstModel = d.configOptions?.find(opt => opt.id === 'model')?.currentValue ?? '';
            
            return (
              <button
                key={d.id}
                type="button"
                disabled={mutation.isPending || !isReady}
                onClick={() => { handleProviderSelect(d.id); }}
                className="group flex items-center justify-between rounded-xl border border-border bg-surface px-4 py-3 text-left transition-colors hover:bg-background disabled:opacity-60 disabled:hover:bg-surface"
              >
                <div className="flex flex-col">
                  <span className="font-medium">{d.label}</span>
                  {firstModel && <span className="text-xs text-text-muted">{firstModel}</span>}
                </div>
                {!isReady && (
                  <span className="rounded-md bg-danger/10 px-2 py-0.5 text-[10px] font-bold text-danger uppercase">
                    Not Found
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>
      {mutation.isPending && (
        <p className="mt-4 text-sm text-text-muted animate-pulse">Creating project...</p>
      )}
      {mutation.isError && (
        <p className="mt-4 text-sm text-danger">Failed to create project. Please try again.</p>
      )}
    </div>
  );
}
