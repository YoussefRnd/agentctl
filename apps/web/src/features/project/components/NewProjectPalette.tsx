import { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DirectoryExplorer } from './DirectoryExplorer';
import {
  AlertCircle,
  Loader2,
  Folder,
  FolderPlus,
  Clock,
  ChevronRight,
  ArrowLeft,
  Bot,
  ArrowUp,
  ChevronDown,
  Check,
  GitBranch,
} from 'lucide-react';
import {
  apiClient,
  openProjectSession,
  providerService,
  type SidebarProject,
} from '@agentctl/api-client';
import { Dropdown, Tooltip, GlassPanel, Button, cn } from '@agentctl/ui';
import type { SessionMode, ProviderDiscovery } from '@agentctl/shared';

function formatRelativeTime(dateInput?: string | Date | null): string {
  if (!dateInput) return 'No recent activity';
  const date = new Date(dateInput);
  if (isNaN(date.getTime())) return 'No recent activity';

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0) return 'Just now';

  const diffSecs = Math.floor(diffMs / 1000);
  if (diffSecs < 60) return 'Just now';

  const diffMins = Math.floor(diffSecs / 60);
  if (diffMins < 60) return `${String(diffMins)}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${String(diffHours)}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${String(diffDays)}d ago`;

  const diffMonths = Math.floor(diffDays / 30);
  return `${String(diffMonths)}mo ago`;
}

function getLastActiveTimestamp(project: SidebarProject): string {
  if (project.sessions.length === 0) return 'No recent activity';
  let latest = 0;
  for (const s of project.sessions) {
    const time = new Date(s.updatedAt).getTime();
    if (!isNaN(time) && time > latest) {
      latest = time;
    }
  }
  return latest > 0 ? formatRelativeTime(new Date(latest)) : 'No recent activity';
}

function getActiveSessionCount(project: SidebarProject): number {
  return project.sessions.filter((s) => s.status !== 'archived' && s.status !== 'discarded').length;
}

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

  // Fetch projects list
  const { data: projects = [] } = useQuery<SidebarProject[]>({
    queryKey: ['projects'],
    queryFn: () => apiClient.fetch<SidebarProject[]>('/api/projects'),
  });

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

  const mutation = useMutation({
    mutationFn: async ({ path, mode }: { path: string; mode: SessionMode }) => {
      return openProjectSession(path, mode);
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
    mutation.mutate({ path: activeProject.path, mode: selectedMode });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleLaunch();
    }
  };

  const shouldShowExplorer = projects.length === 0 || showExplorer;

  return (
    <div className="custom-scrollbar relative flex flex-1 flex-col items-center justify-start overflow-y-auto bg-transparent px-4 py-12 sm:px-6">
      <div className="relative z-10 flex w-full max-w-2xl flex-col items-center space-y-8">
        {mutation.isPending ? (
          <div className="flex flex-col items-center gap-4 py-20">
            <Loader2 className="text-accent h-8 w-8 animate-spin" />
            <div className="space-y-1 text-center">
              <h2 className="text-text-main text-lg font-semibold">Initializing workspace...</h2>
              <p className="text-text-muted text-xs">Setting up your agent session...</p>
            </div>
          </div>
        ) : shouldShowExplorer ? (
          <div className="flex w-full flex-col items-center space-y-4">
            {projects.length > 0 && (
              <div className="flex w-full max-w-xl justify-start">
                <button
                  type="button"
                  onClick={() => {
                    setShowExplorer(false);
                  }}
                  className="text-text-muted hover:text-text-main flex cursor-pointer items-center gap-1.5 text-xs transition-colors"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Back to home
                </button>
              </div>
            )}
            <DirectoryExplorer
              onSelect={(path) => {
                mutation.mutate({ path, mode: selectedMode });
              }}
            />
          </div>
        ) : (
          <>
            {/* Header Hero Section */}
            <div className="space-y-2 text-center">
              <h1 className="text-text-main text-2xl font-bold tracking-tight sm:text-3xl">
                What are we working on?
              </h1>
              <p className="text-text-muted max-w-md text-center text-xs leading-relaxed sm:text-sm">
                Describe a task, refactor, or bugfix to launch an interactive agent session.
              </p>
            </div>

            {mutation.error && (
              <div className="border-danger/30 bg-danger/5 text-danger w-full rounded-xl border p-3.5 text-left text-xs">
                <div className="flex items-center gap-2 font-semibold">
                  <AlertCircle className="text-danger h-4 w-4 shrink-0" />
                  Failed to open workspace
                </div>
                <p className="text-danger/80 mt-1 text-[11px]">{mutation.error.message}</p>
              </div>
            )}

            {/* Chatbox Composer (1:1 with Session CommandBar styling) */}
            <div
              className={cn(
                'border-border bg-surface-secondary/40 relative z-20 flex w-full flex-col rounded-2xl border shadow-2xl ring-1 ring-white/5 backdrop-blur-2xl transition-all duration-300',
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
              <div className="flex items-center justify-between px-3.5 py-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  {/* Workspace Selector Chip */}
                  <Dropdown.Root>
                    <Dropdown.Trigger asChild>
                      <button
                        type="button"
                        className="bg-surface-secondary/60 hover:bg-surface-secondary text-text-main border-border/40 hover:border-border/70 flex h-7 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-all"
                      >
                        <Folder className="text-accent h-3 w-3 shrink-0" />
                        <span className="max-w-[150px] truncate">
                          {activeProject?.name ?? 'Select workspace'}
                        </span>
                        <ChevronDown className="h-2.5 w-2.5 opacity-50" />
                      </button>
                    </Dropdown.Trigger>
                    <Dropdown.Portal>
                      <Dropdown.Content
                        align="start"
                        className="max-h-[300px] w-64 overflow-y-auto"
                      >
                        <div className="text-text-dim px-2.5 py-1 text-[10px] font-semibold tracking-wider uppercase">
                          Workspaces
                        </div>
                        {projects.map((proj) => {
                          const isSelected = proj.id === activeProject?.id;
                          return (
                            <Dropdown.Item
                              key={proj.id}
                              className="hover:bg-surface-secondary text-text-main flex items-center justify-between rounded-md px-2.5 py-1.5 text-xs transition-colors"
                              onSelect={() => {
                                setSelectedProjectId(proj.id);
                              }}
                            >
                              <div className="flex min-w-0 items-center gap-2">
                                {isSelected ? (
                                  <Check className="text-accent h-3 w-3 shrink-0" />
                                ) : (
                                  <div className="h-3 w-3 shrink-0" />
                                )}
                                <span className="truncate font-medium">{proj.name}</span>
                              </div>
                            </Dropdown.Item>
                          );
                        })}
                        <div className="bg-border/30 my-1 h-px" />
                        <Dropdown.Item
                          className="hover:bg-surface-secondary text-text-main flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors"
                          onSelect={() => {
                            setShowExplorer(true);
                          }}
                        >
                          <FolderPlus className="h-3.5 w-3.5 opacity-70" />
                          <span>Open another directory...</span>
                        </Dropdown.Item>
                      </Dropdown.Content>
                    </Dropdown.Portal>
                  </Dropdown.Root>

                  {/* Agent Provider Chip */}
                  {installedProviders.length > 0 && (
                    <Dropdown.Root>
                      <Dropdown.Trigger asChild>
                        <button
                          type="button"
                          className="bg-surface-secondary/60 hover:bg-surface-secondary text-text-main border-border/40 hover:border-border/70 flex h-7 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-all"
                        >
                          <Bot className="text-text-muted h-3 w-3 shrink-0" />
                          <span className="max-w-[140px] truncate">
                            {activeProvider.label || activeProvider.id}
                          </span>
                          <ChevronDown className="h-2.5 w-2.5 opacity-50" />
                        </button>
                      </Dropdown.Trigger>
                      <Dropdown.Portal>
                        <Dropdown.Content align="start" className="w-56">
                          <div className="text-text-dim px-2.5 py-1 text-[10px] font-semibold tracking-wider uppercase">
                            AI Agent
                          </div>
                          {installedProviders.map((provider) => {
                            const isSelected = provider.id === activeProvider.id;
                            return (
                              <Dropdown.Item
                                key={provider.id}
                                className="hover:bg-surface-secondary text-text-main flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs transition-colors"
                                onSelect={() => {
                                  setSelectedProviderId(provider.id);
                                }}
                              >
                                {isSelected ? (
                                  <Check className="text-accent h-3 w-3 shrink-0" />
                                ) : (
                                  <div className="h-3 w-3 shrink-0" />
                                )}
                                <span className="truncate font-medium">
                                  {provider.label || provider.id}
                                </span>
                              </Dropdown.Item>
                            );
                          })}
                        </Dropdown.Content>
                      </Dropdown.Portal>
                    </Dropdown.Root>
                  )}

                  {/* Mode Selector Pill */}
                  <Dropdown.Root>
                    <Dropdown.Trigger asChild>
                      <button
                        type="button"
                        className="bg-surface-secondary/60 hover:bg-surface-secondary text-text-muted hover:text-text-main border-border/40 hover:border-border/70 flex h-7 cursor-pointer items-center gap-1.5 rounded-lg border px-2 text-xs font-medium transition-all"
                      >
                        <GitBranch className="h-3 w-3 opacity-60" />
                        <span className="capitalize">{selectedMode}</span>
                        <ChevronDown className="h-2 w-2 opacity-50" />
                      </button>
                    </Dropdown.Trigger>
                    <Dropdown.Portal>
                      <Dropdown.Content align="start" className="w-40">
                        {(['worktree', 'local'] as SessionMode[]).map((mode) => (
                          <Dropdown.Item
                            key={mode}
                            className="hover:bg-surface-secondary text-text-main flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs capitalize transition-colors"
                            onSelect={() => {
                              setSelectedMode(mode);
                            }}
                          >
                            {selectedMode === mode ? (
                              <Check className="text-accent h-3 w-3 shrink-0" />
                            ) : (
                              <div className="h-3 w-3 shrink-0" />
                            )}
                            <span>{mode}</span>
                          </Dropdown.Item>
                        ))}
                      </Dropdown.Content>
                    </Dropdown.Portal>
                  </Dropdown.Root>
                </div>

                {/* Primary Submit Action (Matches SubmitButton) */}
                <Tooltip content="Start session (Enter)">
                  <Button
                    size="sm"
                    className="bg-accent text-brand-crust flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border-none p-0 shadow-[0_0_20px_rgba(203,166,247,0.25)] transition-all duration-300 hover:opacity-90"
                    onClick={handleLaunch}
                    aria-label="Start session"
                  >
                    <ArrowUp className="h-4 w-4 stroke-[3]" />
                  </Button>
                </Tooltip>
              </div>
            </div>

            {/* Recent Workspaces Grid */}
            {projects.length > 0 && (
              <div className="w-full space-y-3 pt-4">
                <div className="flex items-center justify-between px-1">
                  <h2 className="text-text-muted text-xs font-semibold tracking-wider uppercase">
                    Recent Workspaces
                  </h2>
                  <button
                    type="button"
                    onClick={() => {
                      setShowExplorer(true);
                    }}
                    className="text-text-muted hover:text-accent flex cursor-pointer items-center gap-1 text-xs font-medium transition-colors"
                  >
                    <FolderPlus className="h-3.5 w-3.5" />
                    <span>Open directory</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {projects.map((proj) => {
                    const activeCount = getActiveSessionCount(proj);
                    const lastActive = getLastActiveTimestamp(proj);

                    return (
                      <GlassPanel
                        key={proj.id}
                        className="group border-border/40 hover:border-accent/40 bg-surface-secondary/20 hover:bg-surface-secondary/40 flex cursor-pointer flex-col justify-between rounded-xl p-4 transition-all duration-200"
                      >
                        <div
                          onClick={() => {
                            mutation.mutate({ path: proj.path, mode: selectedMode });
                          }}
                          className="flex flex-col space-y-2.5"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-2.5">
                              <div className="bg-surface-secondary/60 text-accent shrink-0 rounded-lg p-2">
                                <Folder className="h-4 w-4" />
                              </div>
                              <span className="text-text-main group-hover:text-accent truncate text-[14px] font-semibold transition-colors">
                                {proj.name}
                              </span>
                            </div>
                            <ChevronRight className="text-text-muted group-hover:text-accent h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
                          </div>

                          <p className="text-text-muted/70 truncate font-mono text-[11px]">
                            {proj.path}
                          </p>
                        </div>

                        <div className="border-border/20 text-text-muted mt-4 flex items-center justify-between border-t pt-3 text-[11px]">
                          <span className="flex items-center gap-1.5">
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${
                                activeCount > 0 ? 'bg-emerald-500' : 'bg-surface-tertiary'
                              }`}
                            />
                            {activeCount} {activeCount === 1 ? 'active session' : 'active sessions'}
                          </span>
                          <span className="flex items-center gap-1 opacity-80">
                            <Clock className="h-3 w-3" />
                            {lastActive}
                          </span>
                        </div>
                      </GlassPanel>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
