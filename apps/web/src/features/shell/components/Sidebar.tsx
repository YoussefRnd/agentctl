import { useState, useRef, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ListFilter, Settings, AlertCircle, RefreshCw, Layers } from 'lucide-react';
import type { SidebarProject } from '@agentctl/api-client';
import {
  apiClient,
  createProjectSession,
  deleteProject,
  archiveSession,
  deleteSession,
  renameSession,
  rewindSession,
} from '@agentctl/api-client';
import { ConfirmationModal, SearchBar, Switch, Tooltip } from '@agentctl/ui';
import { toast } from 'sonner';
import { ProjectItem } from './ProjectItem';
import { RenameSessionDialog } from './RenameSessionDialog';
import { useFilteredProjects } from '../hooks/useFilteredProjects';

interface SidebarProps {
  activeSessionId?: string;
}

export function Sidebar({ activeSessionId }: SidebarProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();

  const sessionMatch = /\/sessions\/([^/]+)/.exec(location.pathname);
  const currentActiveSessionId = activeSessionId ?? sessionMatch?.[1];

  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedProjects, setCollapsedProjects] = useState<Record<string, boolean>>({});
  const [pendingActions, setPendingActions] = useState<Set<string>>(new Set());

  const isMac =
    typeof window !== 'undefined' &&
    (navigator.platform.toUpperCase().includes('MAC') || navigator.userAgent.includes('Mac'));

  const execute = async <T,>(
    actionKey: string,
    action: () => Promise<T>,
    options?: { successMessage?: string; errorMessage?: string },
  ): Promise<T | null> => {
    setPendingActions((prev) => new Set(prev).add(actionKey));
    try {
      const result = await action();
      if (options?.successMessage) {
        toast.success(options.successMessage);
      }
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : (options?.errorMessage ?? 'Action failed');
      toast.error(msg);
      return null;
    } finally {
      setPendingActions((prev) => {
        const next = new Set(prev);
        next.delete(actionKey);
        return next;
      });
    }
  };

  const [settings, setSettingsState] = useState<{
    sortBy: 'lastActive' | 'name' | 'createdAt';
    gitOnly: boolean;
    showArchived: boolean;
  }>({
    sortBy: 'lastActive',
    gitOnly: false,
    showArchived: false,
  });

  const setSettings = (patch: Partial<typeof settings>) => {
    setSettingsState((prev) => ({ ...prev, ...patch }));
  };

  const { sortBy, gitOnly, showArchived } = settings;

  const [isFilterMenuOpen, setIsFilterMenuOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{ id: string; title: string } | null>(null);
  const [confirmConfig, setConfirmConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    confirmText?: string;
    cancelText?: string;
    type?: 'brand-red' | 'brand-peach' | 'info';
  } | null>(null);

  const {
    data: projects = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['projects', sortBy, gitOnly],
    queryFn: () =>
      apiClient.fetch<SidebarProject[]>(
        `/api/projects?sortBy=${sortBy}&gitOnly=${gitOnly ? 'true' : 'false'}`,
      ),
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const handleCreateSession = (projectId: string) => {
    void execute(`create-session-${projectId}`, () => createProjectSession(projectId), {
      successMessage: 'Session created',
      errorMessage: 'Failed to create session',
    }).then((session) => {
      if (session) {
        void queryClient.invalidateQueries({ queryKey: ['projects'] });
        void navigate(`/sessions/${session.id}`);
      }
    });
  };

  const handleDeleteProject = (projectId: string, projectName: string) => {
    void execute(`delete-project-${projectId}`, () => deleteProject(projectId), {
      successMessage: `Project "${projectName}" removed successfully`,
      errorMessage: 'Failed to remove project',
    }).then((result) => {
      if (result) {
        void queryClient.invalidateQueries({ queryKey: ['projects'] });
        void navigate('/');
      }
    });
  };

  const handleDeleteSession = (sessionId: string, title: string) => {
    void execute(`delete-session-${sessionId}`, () => deleteSession(sessionId), {
      successMessage: `Session "${title}" deleted`,
      errorMessage: 'Failed to delete session',
    }).then((result) => {
      if (result) {
        void queryClient.invalidateQueries({ queryKey: ['projects'] });
        if (currentActiveSessionId === sessionId) {
          void navigate('/');
        }
      }
    });
  };

  const handleArchiveSession = (sessionId: string, title: string) => {
    void execute(`archive-session-${sessionId}`, () => archiveSession(sessionId), {
      successMessage: `Session "${title}" archived`,
      errorMessage: 'Failed to archive session',
    }).then((result) => {
      if (result) {
        void queryClient.invalidateQueries({ queryKey: ['projects'] });
        void queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
      }
    });
  };

  const handleRenameSession = (sessionId: string, currentTitle: string) => {
    setRenameTarget({ id: sessionId, title: currentTitle });
  };

  const handleRenameConfirm = (newTitle: string) => {
    const target = renameTarget;
    if (!target) return;
    if (newTitle.trim() !== target.title) {
      void execute(`rename-session-${target.id}`, () => renameSession(target.id, newTitle.trim()), {
        successMessage: 'Session renamed',
        errorMessage: 'Failed to rename session',
      }).then((result) => {
        if (result) {
          void queryClient.invalidateQueries({ queryKey: ['projects'] });
          void queryClient.invalidateQueries({ queryKey: ['session', target.id] });
        }
      });
    }
    setRenameTarget(null);
  };

  const handleForkSession = (sessionId: string, title: string) => {
    void execute(`fork-session-${sessionId}`, () => rewindSession(sessionId, 999999999, 'fork'), {
      successMessage: `Session "${title}" forked`,
      errorMessage: 'Failed to fork session',
    }).then((result) => {
      if (result?.forkSessionId) {
        void queryClient.invalidateQueries({ queryKey: ['projects'] });
        void navigate(`/sessions/${result.forkSessionId}`);
      }
    });
  };

  const filteredProjects = useFilteredProjects(projects, { searchQuery, showArchived });
  const toggleProject = (id: string) => {
    setCollapsedProjects((prev) => ({ ...prev, [id]: !(prev[id] ?? false) }));
  };

  const totalSessionsCount = filteredProjects.reduce((acc, p) => acc + p.sessions.length, 0);

  return (
    <aside
      aria-label="Main Sidebar"
      className="relative z-20 flex h-full w-full shrink-0 flex-col overflow-hidden bg-transparent"
    >
      {/* Sidebar Header */}
      <div className="border-border/20 bg-surface-secondary/10 flex h-12 shrink-0 items-center justify-between border-b px-4 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <Layers className="text-brand-mauve h-4 w-4" />
          <span className="text-text-main text-[12px] font-bold tracking-tight select-none">
            Workspace
          </span>
        </div>
      </div>

      <div className="mt-4 mb-2 space-y-4 px-4">
        <div className="relative">
          <SearchBar
            ref={searchInputRef}
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
            }}
            onClear={() => {
              setSearchQuery('');
            }}
          />
          {!searchQuery && (
            <div className="pointer-events-none absolute top-1/2 right-3 flex -translate-y-1/2 items-center opacity-60 transition-opacity">
              <kbd className="bg-surface-secondary/80 border-border/50 text-text-muted rounded border px-1.5 py-0.5 font-mono text-[10px] font-bold">
                {isMac ? '⌘K' : 'Ctrl+K'}
              </kbd>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-text-main text-[10px] font-semibold tracking-wider uppercase opacity-40">
              Projects
            </h3>
            {searchQuery && (
              <span className="text-brand-mauve bg-brand-mauve/10 py-0.2 rounded px-1.5 font-mono text-[10px] font-bold">
                {totalSessionsCount} found
              </span>
            )}
          </div>

          <div className="relative flex items-center gap-1.5">
            <Tooltip content="Filter and Sort">
              <button
                type="button"
                onClick={() => {
                  setIsFilterMenuOpen(!isFilterMenuOpen);
                }}
                className={`hover:text-brand-mauve text-text-muted hover:bg-surface-secondary/40 cursor-pointer rounded-sm border border-transparent p-1 transition-all hover:scale-105 active:scale-95 ${isFilterMenuOpen ? 'text-brand-mauve bg-brand-mauve/10 border-brand-mauve/20' : ''}`}
              >
                <ListFilter className="h-3.5 w-3.5" />
              </button>
            </Tooltip>

            {isFilterMenuOpen && (
              <>
                <button
                  type="button"
                  aria-label="Close filter menu"
                  className="fixed inset-0 z-30 cursor-default border-none bg-transparent outline-none"
                  onClick={() => {
                    setIsFilterMenuOpen(false);
                  }}
                />
                <div className="border-border/80 bg-surface-secondary/95 animate-in fade-in slide-in-from-top-2 absolute top-full right-0 z-40 mt-1 w-52 rounded-xl border p-2.5 font-sans text-[11px] shadow-2xl backdrop-blur-md duration-200">
                  <div className="text-text-muted mb-1.5 px-2 text-[10px] font-semibold tracking-wider uppercase opacity-50">
                    Sort by
                  </div>
                  <div className="space-y-0.5">
                    {(['lastActive', 'name', 'createdAt'] as const).map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => {
                          setSettings({ sortBy: opt });
                          setIsFilterMenuOpen(false);
                        }}
                        className={`hover:bg-surface-tertiary flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left transition-colors ${sortBy === opt ? 'text-brand-mauve font-bold' : 'text-text-muted hover:text-text-main font-medium'}`}
                      >
                        <span>
                          {opt === 'lastActive'
                            ? 'Last active'
                            : opt === 'name'
                              ? 'Name (A-Z)'
                              : 'Date created'}
                        </span>
                        {sortBy === opt && <span className="text-brand-mauve text-[10px]">●</span>}
                      </button>
                    ))}
                  </div>

                  <div className="border-border/30 my-2 border-t" />

                  <div className="text-text-muted mb-1.5 px-2 text-[10px] font-semibold tracking-wider uppercase opacity-50">
                    Filter
                  </div>
                  <div className="space-y-1">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSettings({ gitOnly: !gitOnly });
                      }}
                      className={`hover:bg-surface-tertiary flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left transition-colors ${gitOnly ? 'text-brand-mauve font-bold' : 'text-text-muted hover:text-text-main font-medium'}`}
                    >
                      <span>Git repos only</span>
                      <Switch
                        checked={gitOnly}
                        size="sm"
                        aria-label="Git repos only"
                        className="pointer-events-none"
                      />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSettings({ showArchived: !showArchived });
                      }}
                      className={`hover:bg-surface-tertiary flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left transition-colors ${showArchived ? 'text-brand-mauve font-bold' : 'text-text-muted hover:text-text-main font-medium'}`}
                    >
                      <span>Show archived sessions</span>
                      <Switch
                        checked={showArchived}
                        size="sm"
                        aria-label="Show archived sessions"
                        className="pointer-events-none"
                      />
                    </button>
                  </div>
                </div>
              </>
            )}

            <Tooltip content="Add Project">
              <Link
                to="/"
                className="hover:text-brand-mauve text-text-muted hover:bg-brand-mauve/10 flex items-center justify-center rounded-sm border border-transparent p-1 transition-all hover:scale-105 active:scale-95"
              >
                <Plus className="h-3.5 w-3.5" />
              </Link>
            </Tooltip>
          </div>
        </div>
      </div>

      <div className="mt-2 flex-1 overflow-y-auto px-3 pb-8">
        {isLoading ? (
          <div className="space-y-3 p-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="bg-text-main/5 h-2.5 w-full animate-pulse rounded-full" />
            ))}
          </div>
        ) : isError ? (
          <div className="bg-danger/10 border-danger/20 my-2 space-y-2.5 rounded-xl border p-3.5 text-center">
            <div className="text-danger flex items-center justify-center gap-1.5 text-xs font-semibold">
              <AlertCircle className="h-4 w-4" />
              Failed to load projects
            </div>
            <button
              type="button"
              onClick={() => {
                void refetch();
              }}
              className="bg-danger/20 hover:bg-danger/30 border-danger/30 text-danger inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1 text-[11px] font-bold transition-all"
            >
              <RefreshCw className="h-3 w-3" />
              Retry
            </button>
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <p className="text-text-muted/60 text-xs font-medium">No matching projects</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {filteredProjects.map((proj) => {
              const hasActiveSession = proj.sessions.some((s) => s.id === currentActiveSessionId);
              const isCollapsed = collapsedProjects[proj.id] ?? !hasActiveSession;

              return (
                <ProjectItem
                  key={proj.id}
                  proj={proj}
                  activeSessionId={currentActiveSessionId}
                  isCollapsed={isCollapsed}
                  searchQuery={searchQuery}
                  isCreatingSession={pendingActions.has(`create-session-${proj.id}`)}
                  pendingActions={pendingActions}
                  toggleProject={toggleProject}
                  setConfirmConfig={setConfirmConfig}
                  handleDeleteProject={handleDeleteProject}
                  handleCreateSession={handleCreateSession}
                  handleArchiveSession={handleArchiveSession}
                  handleDeleteSession={handleDeleteSession}
                  handleRenameSession={handleRenameSession}
                  handleForkSession={handleForkSession}
                />
              );
            })}
          </div>
        )}
      </div>

      <div className="border-border/40 relative z-10 mt-auto border-t p-2">
        <Link
          to="/settings"
          className="text-text-muted hover:text-brand-mauve hover:bg-surface-secondary group flex w-full items-center gap-2 rounded-lg p-2 text-[11px] font-medium transition-all"
        >
          <Settings className="h-4 w-4" />
          <span>Settings</span>
        </Link>
      </div>

      <ConfirmationModal
        isOpen={!!confirmConfig?.isOpen}
        title={confirmConfig?.title ?? ''}
        message={confirmConfig?.message ?? ''}
        onConfirm={
          confirmConfig?.onConfirm ??
          (() => {
            /* noop */
          })
        }
        onCancel={() => {
          setConfirmConfig(null);
        }}
        confirmText={confirmConfig?.confirmText}
        cancelText={confirmConfig?.cancelText}
        type={confirmConfig?.type}
      />

      <RenameSessionDialog
        open={renameTarget !== null}
        currentTitle={renameTarget?.title ?? ''}
        onConfirm={handleRenameConfirm}
        onCancel={() => {
          setRenameTarget(null);
        }}
      />
    </aside>
  );
}
