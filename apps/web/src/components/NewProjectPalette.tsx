import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client.js';
import { DirectoryExplorer } from './DirectoryExplorer.js';
import { Plus, ArrowRight, Bot, Cpu, Sparkles } from 'lucide-react';
import type { DriverDiscovery } from '@agentctl/shared';

interface CreateProjectResponse {
  project: { id: string; name: string; path: string };
}

interface CreateSessionResponse {
  id: string;
}

export function NewProjectPalette() {
  const navigate = useNavigate();
  const [projectPath, setProjectPath] = useState('');
  const [step, setStep] = useState<'welcome' | 'explore' | 'harness'>('welcome');

  const { data: drivers = [], isLoading: isLoadingDrivers } = useQuery({
    queryKey: ['drivers'],
    queryFn: () => apiClient.fetch<DriverDiscovery[]>('/api/drivers'),
  });

  const mutation = useMutation({
    mutationFn: async (payload: { path: string; selectedDriver: string }) => {
      // 1. Create project
      const { project } = await apiClient.fetch<CreateProjectResponse>('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ path: payload.path }),
      });

      // 2. Create session
      return apiClient.fetch<CreateSessionResponse>('/api/sessions', {
        method: 'POST',
        body: JSON.stringify({
          projectId: project.id,
          agent: payload.selectedDriver,
          taskSlug: 'setup',
        }),
      });
    },
    onSuccess: (data) => {
      void navigate(`/sessions/${data.id}`);
    },
  });

  const handleFolderSelect = (path: string) => {
    setProjectPath(path);
    setStep('harness');
  };

  const handleHarnessSelect = (driverId: string) => {
    mutation.mutate({ path: projectPath, selectedDriver: driverId });
  };

  if (step === 'welcome') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-background relative overflow-hidden">
        <div className="max-w-2xl w-full text-center animate-in fade-in zoom-in-95 duration-1000 relative z-10">
          <h1 className="text-5xl font-black mb-12 tracking-tight text-text-main">
            Welcome to Agent Workbench!
          </h1>

          <button 
            onClick={() => { setStep('explore'); }}
            className="group inline-flex items-center gap-4 rounded-xl border border-border bg-surface/50 px-8 py-4 text-base font-bold text-text-main transition-all hover:bg-surface hover:border-accent/40 active:scale-95 shadow-2xl"
          >
            <Plus className="w-5 h-5 text-accent" />
            Add Your First Project
            <kbd className="bg-background px-2 py-1 rounded border border-border text-[12px] opacity-40 group-hover:opacity-100 transition-opacity">
              ↵
            </kbd>
          </button>
        </div>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1000px] h-[1000px] bg-accent/5 rounded-full blur-[150px] -z-0 pointer-events-none opacity-50"></div>
      </div>
    );
  }

  if (step === 'explore') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-background animate-in fade-in duration-500">
        <div className="mb-12 text-center">
          <h2 className="text-3xl font-black tracking-tight mb-3">Select Repository</h2>
          <p className="text-text-muted text-lg">Choose the folder where you want to collaborate.</p>
        </div>
        <DirectoryExplorer onSelect={handleFolderSelect} />
        <button 
          onClick={() => { setStep('welcome'); }}
          className="mt-8 text-sm font-bold text-text-muted hover:text-text-main transition-colors uppercase tracking-widest"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex items-center justify-center p-8 bg-background animate-in fade-in duration-500">
      <div className="max-w-xl w-full">
        <div className="mb-12 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-surface border border-border rounded-full text-[11px] font-mono text-accent/80 mb-6">
            <span className="w-1.5 h-1.5 bg-accent rounded-full animate-pulse" />
            READY: {projectPath}
          </div>
          <h2 className="text-4xl font-black tracking-tight mb-3">Pick Your Harness</h2>
          <p className="text-text-muted text-lg">Choose an agent specialized for your tech stack.</p>
        </div>

        <div className="grid grid-cols-1 gap-3">
          {isLoadingDrivers ? (
            <div className="py-20 flex flex-col items-center gap-4">
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-accent border-t-transparent" />
              <span className="text-[10px] font-black text-text-muted tracking-[0.2em] uppercase">Initializing Harnesses</span>
            </div>
          ) : (
            drivers.map((d) => {
              const isReady = d.status === 'ready';
              const firstModel = d.configOptions?.find((opt) => opt.id === 'model')?.currentValue ?? '';
              
              return (
                <button
                  key={d.id}
                  type="button"
                  disabled={mutation.isPending || !isReady}
                  onClick={() => { handleHarnessSelect(d.id); }}
                  className="group relative flex items-center gap-5 rounded-2xl border border-border bg-surface p-6 text-left transition-all hover:border-accent/40 hover:bg-surface-hover hover:scale-[1.02] disabled:opacity-50 disabled:hover:scale-100 shadow-sm"
                >
                  <div className="shrink-0 w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center group-hover:bg-accent group-hover:text-background transition-colors">
                    {d.id.includes('claude') ? <Bot className="w-6 h-6" /> : <Cpu className="w-6 h-6" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-bold text-xl">{d.label}</span>
                      {isReady && <span className="w-2 h-2 bg-success rounded-full shadow-[0_0_10px_rgba(16,185,129,0.5)]" />}
                    </div>
                    <p className="text-sm text-text-muted font-medium truncate">{firstModel || 'Official ACP Harness'}</p>
                  </div>
                  {!isReady ? (
                    <span className="rounded-lg bg-danger/10 px-2.5 py-1 text-[10px] font-black text-danger uppercase tracking-tight">
                      Offline
                    </span>
                  ) : (
                    <ArrowRight className="w-5 h-5 text-text-muted group-hover:text-accent group-hover:translate-x-1 transition-all" />
                  )}
                </button>
              );
            })
          )}
        </div>

        <div className="mt-10 flex items-center justify-between">
          <button 
            onClick={() => { setStep('explore'); }}
            className="text-xs font-black text-text-muted hover:text-text-main transition-colors uppercase tracking-[0.2em]"
          >
            ← Change Folder
          </button>
          {mutation.isPending && (
            <div className="flex items-center gap-3 text-sm text-accent font-bold animate-pulse">
              <Sparkles className="w-4 h-4" />
              ORCHESTRATING WORKSPACE
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
