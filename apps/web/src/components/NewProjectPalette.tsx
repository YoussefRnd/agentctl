import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { useDirectoryPicker } from '../hooks/useDirectoryPicker.js';
import { apiClient } from '../lib/api-client.js';

type DriverName = 'claude-code' | 'gemini-cli' | 'opencode' | 'codex-acp';

const DRIVERS: { driver: DriverName; label: string; defaultModel: string }[] = [
  { driver: 'claude-code', label: 'Claude Code', defaultModel: 'sonnet-4' },
  { driver: 'gemini-cli', label: 'Gemini CLI', defaultModel: 'gemini-2.5-pro' },
  { driver: 'opencode', label: 'OpenCode', defaultModel: 'default' },
  { driver: 'codex-acp', label: 'Codex ACP', defaultModel: 'default' },
];

interface CreateProjectResponse {
  project: { id: string; name: string; path: string };
  sessionId: string;
}

export function NewProjectPalette() {
  const navigate = useNavigate();
  const { pickDirectory } = useDirectoryPicker();
  const [projectPath, setProjectPath] = useState('');
  const [projectName, setProjectName] = useState('');
  const [step, setStep] = useState<'idle' | 'path' | 'provider'>('idle');

  const mutation = useMutation({
    mutationFn: (payload: { path: string; selectedDriver: DriverName }) =>
      apiClient.fetch<CreateProjectResponse>('/api/projects', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: (data) => {
      void navigate(`/sessions/${data.sessionId}`);
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

  const handleProviderSelect = useCallback((driver: DriverName) => {
    mutation.mutate({ path: projectPath, selectedDriver: driver });
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
        <p className="text-sm text-text-muted mb-4">Enter the full path to your project directory</p>
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
            className="inline-flex items-center gap-2 rounded-xl bg-accent px-6 py-3 text-background font-semibold transition-colors hover:bg-accent-hover disabled:opacity-50"
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
      <div className="flex flex-col gap-2 w-64">
        {DRIVERS.map((d) => (
          <button
            key={d.driver}
            type="button"
            disabled={mutation.isPending}
            onClick={() => { handleProviderSelect(d.driver); }}
            className="flex items-center justify-between rounded-xl border border-border bg-surface px-4 py-3 text-left transition-colors hover:bg-background disabled:opacity-50"
          >
            <span className="font-medium">{d.label}</span>
            <span className="text-xs text-text-muted">{d.defaultModel}</span>
          </button>
        ))}
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
