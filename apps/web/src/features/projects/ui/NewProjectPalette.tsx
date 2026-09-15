import { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DirectoryExplorer } from './DirectoryExplorer.js';
import { RecentWorkspacesGrid } from './RecentWorkspacesGrid.js';
import { NewProjectToolbar } from './NewProjectToolbar.js';
import { AlertCircle, Loader2, ArrowLeft } from 'lucide-react';
import { openProjectSession, providerService } from '@agentctl/api-client';
import { cn } from '@agentctl/ui';
import type { SessionMode, ProviderDiscovery } from '@agentctl/shared';
import { projectQueries } from '../api/projectQueries.js';

export function NewProjectPalette() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [prompt, setPrompt] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [selectedMode, setSelectedMode] = useState<SessionMode>('worktree');
  const [selectedProviderId, setSelectedProviderId] = useState<string>('');
  const [showExplorer, setShowExplorer] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  // Fetch projects list via query options
  const { data: projects = [] } = useQuery(projectQueries.all());

  // Fetch available providers
  const { data: providers = [] } = useQuery<ProviderDiscovery[]>({
    queryKey: ['providers'],
    queryFn: () => providerService.getProviders(),
  });

  const installedProviders = useMemo(
    () => providers.filter((p) => p.installState !== 'not_installed'),
    [providers],
  );

  // Focus textarea on load
  useEffect(() => {
    if (!showExplorer) {
      textareaRef.current?.focus();
    }
  }, [showExplorer]);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }, [prompt]);

  const activeProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId) ?? projects[0],
    [projects, selectedProjectId],
  );

  const activeProvider = useMemo(
    () =>
      installedProviders.find((p) => p.id === selectedProviderId) ??
      installedProviders[0] ?? {
        id: 'agent',
        label: 'Default Agent',
      },
    [installedProviders, selectedProviderId],
  );
  const launchProviderId = installedProviders.length > 0 ? activeProvider.id : undefined;

  const mutation = useMutation({
    mutationFn: async ({
      path,
      mode,
      agent,
    }: {
      path: string;
      mode: SessionMode;
      agent?: string;
    }) => {
      return openProjectSession(path, mode, agent);
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      void navigate(`/sessions/${data.session.id}`, {
        state: { initialPrompt: prompt.trim() || undefined },
      });
    },
  });

  const handleLaunch = () => {
    if (!activeProject) {
      setShowExplorer(true);
      return;
    }
    mutation.mutate({
      path: activeProject.path,
      mode: selectedMode,
      agent: launchProviderId,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleLaunch();
    }
  };

  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center overflow-y-auto p-4 py-8 select-none">
      <div className="flex w-full max-w-2xl flex-col items-center space-y-6">
        {showExplorer ? (
          <div className="w-full space-y-4">
            <button
              type="button"
              onClick={() => {
                setShowExplorer(false);
              }}
              className="text-text-muted hover:text-text-main flex cursor-pointer items-center gap-1.5 text-xs font-medium transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>Back to prompt</span>
            </button>
            <DirectoryExplorer
              onSelect={(dirPath: string) => {
                mutation.mutate({
                  path: dirPath,
                  mode: selectedMode,
                  agent: launchProviderId,
                });
              }}
            />
          </div>
        ) : (
          <>
            {/* Header / Brand */}
            <div className="flex flex-col items-center space-y-2 text-center">
              <h1 className="text-text-main text-2xl font-bold tracking-tight sm:text-3xl">
                What are you working on?
              </h1>
              <p className="text-text-muted text-xs sm:text-sm">
                Type your initial instructions or pick a workspace to get started.
              </p>
            </div>

            {/* Error Message */}
            {mutation.isError && (
              <div className="bg-danger/10 border-danger/20 text-danger flex w-full items-center gap-2 rounded-xl border p-3 text-xs">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>
                  {mutation.error instanceof Error
                    ? mutation.error.message
                    : 'Failed to create session'}
                </span>
              </div>
            )}

            {/* Main Command Input Box */}
            <div
              className={cn(
                'border-border bg-surface-secondary/40 relative z-20 flex w-full flex-col rounded-2xl border shadow-2xl ring-1 ring-white/5 backdrop-blur-2xl transition-colors duration-300',
                isFocused
                  ? 'border-accent/40 shadow-accent/5 ring-accent/20 ring-2'
                  : 'hover:border-border/80',
              )}
            >
              {/* Textarea container */}
              <div className="relative flex flex-col p-4 pb-2">
                <textarea
                  ref={textareaRef}
                  value={prompt}
                  aria-label="Task or prompt description"
                  onChange={(e) => {
                    setPrompt(e.target.value);
                  }}
                  onFocus={() => {
                    setIsFocused(true);
                  }}
                  onBlur={() => {
                    setIsFocused(false);
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder="Describe your task, refactor, or question..."
                  rows={2}
                  className="placeholder:text-text-muted/40 text-text-main max-h-[200px] min-h-[56px] w-full resize-none bg-transparent font-sans text-sm leading-relaxed outline-none"
                />
              </div>

              {/* Toolbar matching CommandBarToolbar */}
              <NewProjectToolbar
                projects={projects}
                activeProject={activeProject}
                setSelectedProjectId={setSelectedProjectId}
                setShowExplorer={setShowExplorer}
                installedProviders={installedProviders}
                activeProvider={activeProvider}
                setSelectedProviderId={setSelectedProviderId}
                selectedMode={selectedMode}
                setSelectedMode={setSelectedMode}
                handleLaunch={handleLaunch}
              />
            </div>

            {/* Recent Workspaces Grid */}
            <RecentWorkspacesGrid
              projects={projects}
              selectedMode={selectedMode}
              onOpenDirectory={() => {
                setShowExplorer(true);
              }}
              onSelectProject={(path, mode) => {
                mutation.mutate({
                  path,
                  mode,
                  agent: launchProviderId,
                });
              }}
            />
          </>
        )}
      </div>

      {mutation.isPending && (
        <div className="bg-background/80 fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="text-accent h-8 w-8 animate-spin" />
            <p className="text-text-main text-sm font-medium">Starting workspace session...</p>
          </div>
        </div>
      )}
    </div>
  );
}
