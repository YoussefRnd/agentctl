import { useState, useRef, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, MessageSquare, Folder } from 'lucide-react';
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
import { ConfirmationModal, Tooltip, cn } from '@agentctl/ui';
import { toast } from 'sonner';
import { SidebarProjectList } from './SidebarProjectList';
import { SidebarTranscriptResults } from './SidebarTranscriptResults';
import { RenameSessionDialog } from './RenameSessionDialog';
import { SidebarSearch } from './SidebarSearch';
import { SidebarFilterMenu, type SortByOption } from './SidebarFilterMenu';
import { SidebarFooter } from './SidebarFooter';
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
  const [searchTab, setSearchTab] = useState<'workspaces' | 'messages'>('workspaces');
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
    sortBy: SortByOption;
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
    refetchInterval: 2500,
    staleTime: 1000,
  });

  useEffect(() => {
    let runningCount = 0;
    let needsAttentionCount = 0;
    for (const project of projects) {
      for (const session of project.sessions ?? []) {
        if (session.status === 'running') runningCount++;
        else if (session.status === 'needs_attention') needsAttentionCount++;
      }
    }

    const electronAPI = (
      window as unknown as {
        electronAPI?: {
          updateTrayStatus?: (status: {
            runningCount: number;
            needsAttentionCount: number;
          }) => void;
        };
      }
    ).electronAPI;

    electronAPI?.updateTrayStatus?.({ runningCount, needsAttentionCount });
  }, [projects]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isInput =
        activeEl instanceof HTMLInputElement ||
        activeEl instanceof HTMLTextAreaElement ||
        activeEl?.getAttribute('contenteditable') === 'true';

      if ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.code === 'KeyF')) {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === '/' && !isInput) {
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
      className="relative z-20 flex h-full w-full shrink-0 flex-col overflow-hidden bg-transparent select-none"
    >
      <div className="space-y-2.5 px-3 pt-3 pb-2">
        <SidebarSearch
          ref={searchInputRef}
          value={searchQuery}
          onChange={setSearchQuery}
          onClear={() => {
            setSearchQuery('');
          }}
          isMac={isMac}
        />

        {searchQuery.trim().length > 0 ? (
          <div className="bg-surface-secondary/30 border-border/20 flex items-center justify-between gap-1 rounded-lg border p-0.5">
            <button
              type="button"
              onClick={() => {
                setSearchTab('workspaces');
              }}
              className={cn(
                'flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-all select-none',
                searchTab === 'workspaces'
                  ? 'bg-surface-secondary text-text-main font-semibold shadow-xs'
                  : 'text-text-muted hover:text-text-main',
              )}
            >
              <Folder className="h-3 w-3" />
              <span>Workspaces</span>
              <span className="font-mono text-[10px] opacity-70">({totalSessionsCount})</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setSearchTab('messages');
              }}
              className={cn(
                'flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-all select-none',
                searchTab === 'messages'
                  ? 'bg-surface-secondary text-text-main font-semibold shadow-xs'
                  : 'text-text-muted hover:text-text-main',
              )}
            >
              <MessageSquare className="h-3 w-3" />
              <span>Messages</span>
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between px-0.5">
            <div className="flex items-center gap-1.5">
              <span className="text-text-muted/60 text-[10px] font-bold tracking-wider uppercase">
                Workspaces
              </span>
            </div>

            <div className="flex items-center gap-0.5">
              <SidebarFilterMenu
                isOpen={isFilterMenuOpen}
                onToggle={() => {
                  setIsFilterMenuOpen(!isFilterMenuOpen);
                }}
                onClose={() => {
                  setIsFilterMenuOpen(false);
                }}
                sortBy={sortBy}
                gitOnly={gitOnly}
                showArchived={showArchived}
                onSettingsChange={setSettings}
              />

              <Tooltip content="Add workspace">
                <Link
                  to="/"
                  className="text-text-muted hover:text-text-main hover:bg-surface-secondary/80 flex h-7 w-7 items-center justify-center rounded-lg border border-transparent transition-colors"
                  aria-label="Add workspace"
                >
                  <Plus className="h-3.5 w-3.5" />
                </Link>
              </Tooltip>
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-2.5 pb-6">
        {searchQuery.trim().length > 0 && searchTab === 'messages' ? (
          <SidebarTranscriptResults
            searchQuery={searchQuery}
            onSelectResult={(sessionId, eventId) => {
              void navigate(`/sessions/${sessionId}`, {
                state: { targetEventId: eventId },
              });
            }}
          />
        ) : (
          <SidebarProjectList
            isLoading={isLoading}
            isError={isError}
            refetch={refetch}
            filteredProjects={filteredProjects}
            searchQuery={searchQuery}
            currentActiveSessionId={currentActiveSessionId}
            collapsedProjects={collapsedProjects}
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
        )}
      </div>

      <SidebarFooter />

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
