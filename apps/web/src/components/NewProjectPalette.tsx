import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client.js';
import { DirectoryExplorer } from './DirectoryExplorer.js';
import type { DriverDiscovery } from '@agentctl/shared';
import { ArrowRight, Bot, Cpu, Sparkles, Terminal } from 'lucide-react';

interface CreateProjectResponse {
  project: { id: string; name: string; path: string };
}

interface CreateSessionResponse {
  id: string;
}

export function NewProjectPalette() {
  const navigate = useNavigate();
  const [projectPath, setProjectPath] = useState('');
  const [step, setStep] = useState<'idle' | 'explore' | 'provider'>('idle');

  const { data: drivers = [], isLoading: isLoadingDrivers } = useQuery({
    queryKey: ['drivers'],
    queryFn: () => apiClient.fetch<DriverDiscovery[]>('/api/drivers'),
  });

  const mutation = useMutation({
    mutationFn: async (payload: { path: string; selectedDriver: string }) => {
      const { project } = await apiClient.fetch<CreateProjectResponse>('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ path: payload.path }),
      });

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

  const handleFolderSelect = useCallback((path: string) => {
    setProjectPath(path);
    setStep('provider');
  }, []);

  const handleProviderSelect = useCallback((driverId: string) => {
    mutation.mutate({ path: projectPath, selectedDriver: driverId });
  }, [mutation, projectPath]);

  if (step === 'idle') {
    return (
      <div className="flex-1 flex items-center justify-center p-8 bg-background">
        <div className="max-w-2xl w-full text-center animate-in fade-in zoom-in-95 duration-700">
          <div className="inline-flex p-4 rounded-3xl bg-accent/10 mb-8">
            <Sparkles className="w-10 h-10 text-accent" />
          </div>
          <h1 className="text-4xl font-black mb-4 tracking-tight">Agent Workbench</h1>
          <p className="text-text-muted text-lg mb-12 max-w-lg mx-auto leading-relaxed">
            Collaborate with Gemini to build, refactor, and deploy code directly in your local repositories.
          </p>
          <div className="flex items-center justify-center gap-4">
            <button
              type="button"
              onClick={() => { setStep('explore'); }}
              className="group inline-flex items-center gap-3 rounded-2xl bg-accent px-8 py-4 text-background font-bold transition-all hover:scale-105 hover:bg-accent-hover shadow-[0_8px_30px_rgb(59,130,246,0.2)]"
            >
              Open Project Folder
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'explore') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-background animate-in fade-in duration-500">
        <div className="mb-12 text-center">
          <h2 className="text-2xl font-bold mb-2">Select Repository</h2>
          <p className="text-text-muted">Choose the folder where you want Gemini to work.</p>
        </div>
        <DirectoryExplorer onSelect={handleFolderSelect} />
        <button 
          onClick={() => { setStep('idle'); }}
          className="mt-8 text-sm text-text-muted hover:text-text-main transition-colors"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex items-center justify-center p-8 bg-background animate-in fade-in duration-500">
      <div className="max-w-xl w-full">
        <div className="mb-10 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-surface border border-border rounded-full text-xs font-mono text-text-muted mb-4">
            <Terminal className="w-3 h-3" />
            {projectPath}
          </div>
          <h2 className="text-3xl font-black tracking-tight mb-2">Choose Harness</h2>
          <p className="text-text-muted">Select the AI agent specialized for this task.</p>
        </div>

        <div className="grid grid-cols-1 gap-3">
          {isLoadingDrivers ? (
            <div className="py-20 flex flex-col items-center gap-4">
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-accent border-t-transparent" />
              <span className="text-xs font-bold text-text-muted tracking-widest uppercase">Initializing Drivers</span>
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
                  className="group relative flex items-center gap-4 rounded-2xl border border-border bg-surface p-5 text-left transition-all hover:border-accent/50 hover:bg-surface-hover hover:scale-[1.02] disabled:opacity-50 disabled:hover:scale-100"
                >
                  <div className="shrink-0 w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center group-hover:bg-accent group-hover:text-background transition-colors">
                    {d.id.includes('claude') ? <Bot className="w-6 h-6" /> : <Cpu className="w-6 h-6" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-bold text-lg">{d.label}</span>
                      {isReady && <span className="w-1.5 h-1.5 bg-success rounded-full" />}
                    </div>
                    <p className="text-sm text-text-muted truncate">{firstModel || 'Standard ACP Harness'}</p>
                  </div>
                  {!isReady ? (
                    <span className="rounded-lg bg-danger/10 px-2.5 py-1 text-[10px] font-black text-danger uppercase tracking-tighter">
                      Inactive
                    </span>
                  ) : (
                    <ArrowRight className="w-5 h-5 text-text-muted group-hover:text-accent transition-colors" />
                  )}
                </button>
              );
            })
          )}
        </div>

        <div className="mt-8 flex items-center justify-between">
          <button 
            onClick={() => { setStep('explore'); }}
            className="text-sm font-medium text-text-muted hover:text-text-main transition-colors"
          >
            ← Back to Folder
          </button>
          {mutation.isPending && (
            <div className="flex items-center gap-2 text-sm text-accent font-bold animate-pulse">
              <Sparkles className="w-4 h-4" />
              Building Workspace...
            </div>
          )}
          {mutation.isError && (
            <p className="text-sm text-danger font-medium tracking-tight italic">Creation failed. Try again.</p>
          )}
        </div>
      </div>
    </div>
  );
}
