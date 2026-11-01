import { useWorkspaceDrop } from './model/useWorkspaceDrop';
import { providerKeys, sessionKeys, projectKeys } from '@/shared/lib/queryKeys';
import { useState, useRef, useEffect, useMemo } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, FolderUp } from 'lucide-react';
import type { SidebarProject } from '@agentctl/api-client';
import {
  apiClient,
  deleteProject,
  archiveSession,
  deleteSession,
  renameSession,
  rewindSession,
  patchSession,
  providerService,
} from '@agentctl/api-client';
import { ConfirmationModal, IconButton, Tooltip, cn } from '@agentctl/ui';
import { toast } from 'sonner';
import { SidebarProjectList } from './SidebarProjectList';
import { SidebarTranscriptResults } from './SidebarTranscriptResults';
import { RenameSessionDialog } from './RenameSessionDialog';
import { SidebarSearch } from './SidebarSearch';
import { SidebarFilterMenu, type SortByOption } from './SidebarFilterMenu';
import { SidebarFooter } from './SidebarFooter';
import { useFilteredProjects } from './model/useFilteredProjects';
import { useProjectExpansionStore } from '@/shared/stores/useProjectExpansionStore';

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
  const collapsedProjects = useProjectExpansionStore((state) => state.collapsedProjects);
  const setProjectCollapsed = useProjectExpansionStore((state) => state.setProjectCollapsed);
  const keepProjectExpanded = useProjectExpansionStore((state) => state.keepProjectExpanded);
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
    staleTime: 2000,
    refetchOnWindowFocus: true,
  });

  const { data: providers = [] } = useQuery({
    queryKey: providerKeys.all,
    queryFn: () => providerService.getProviders(),
    staleTime: 2_000,
  });
  const providersById = useMemo(
    () => new Map(providers.map((provider) => [provider.id, provider])),
    [providers],
  );

  const handlePinSession = (sessionId: string, pinned: boolean) => {
    void execute(`pin-session-${sessionId}`, () => patchSession(sessionId, { pinned }), {
      errorMessage: pinned ? 'Failed to pin session' : 'Failed to unpin session',
    }).then((result) => {
      if (result) void queryClient.invalidateQueries({ queryKey: projectKeys.all });
    });
  };

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
    void navigate(`/?project=${encodeURIComponent(projectId)}`);
  };

  const handleDeleteProject = (projectId: string, projectName: string) => {
    void execute(`delete-project-${projectId}`, () => deleteProject(projectId), {
      successMessage: `Project "${projectName}" removed successfully`,
      errorMessage: 'Failed to remove project',
    }).then((result) => {
      if (result) {
        void queryClient.invalidateQueries({ queryKey: projectKeys.all });
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
        if (currentActiveSessionId === sessionId) {
          const project = projects.find((project) =>
            project.sessions.some((session) => session.id === sessionId),
          );
          if (project) keepProjectExpanded(project.id);
        }
        void queryClient.invalidateQueries({ queryKey: projectKeys.all });
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
        void queryClient.invalidateQueries({ queryKey: projectKeys.all });
        void queryClient.invalidateQueries({ queryKey: sessionKeys.detail(sessionId) });
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
          void queryClient.invalidateQueries({ queryKey: projectKeys.all });
          void queryClient.invalidateQueries({ queryKey: sessionKeys.detail(target.id) });
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
        void queryClient.invalidateQueries({ queryKey: projectKeys.all });
        void navigate(`/sessions/${result.forkSessionId}`);
      }
    });
  };

  const filteredProjects = useFilteredProjects(projects, { searchQuery, showArchived });
  const toggleProject = (id: string, isCollapsed: boolean) => {
    setProjectCollapsed(id, !isCollapsed);
  };

  const totalSessionsCount = filteredProjects.reduce((acc, p) => acc + p.sessions.length, 0);

  const { isDraggingOverSidebar, handleDragEnter, handleDragOver, handleDragLeave, handleDrop } =
    useWorkspaceDrop(projects);
  return (
    <aside
      aria-label="Main Sidebar"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        'relative z-20 flex h-full w-full shrink-0 flex-col overflow-hidden bg-transparent tracking-normal transition-colors duration-150 select-none',
        isDraggingOverSidebar && 'ring-accent/20 bg-accent/[0.015] ring-1 ring-inset',
      )}
    >
      <div className="space-y-3 px-3 pt-3 pb-2">
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
          <div className="bg-surface-secondary/50 flex items-center gap-1 rounded-lg p-1">
            <button
              type="button"
              onClick={() => {
                setSearchTab('workspaces');
              }}
              className={cn(
                'control-compact text-role-control motion-disclosure focus-visible:ring-accent/40 flex min-w-0 flex-1 cursor-pointer items-center justify-center gap-2 rounded-md focus-visible:ring-2 focus-visible:outline-none',
                searchTab === 'workspaces'
                  ? 'bg-surface-tertiary/60 text-text-main'
                  : 'text-text-muted hover:text-text-main',
              )}
            >
              <span>Workspaces</span>
              <span className="text-role-caption text-text-muted tabular-nums">
                ({totalSessionsCount})
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                setSearchTab('messages');
              }}
              className={cn(
                'control-compact text-role-control motion-disclosure focus-visible:ring-accent/40 flex min-w-0 flex-1 cursor-pointer items-center justify-center gap-2 rounded-md focus-visible:ring-2 focus-visible:outline-none',
                searchTab === 'messages'
                  ? 'bg-surface-tertiary/60 text-text-main'
                  : 'text-text-muted hover:text-text-main',
              )}
            >
              <span>Messages</span>
            </button>
          </div>
        ) : (
          <div className="flex min-h-7 items-center justify-between px-2">
            <div className="flex items-center gap-1.5">
              <span className="text-role-eyebrow text-text-muted">Workspaces</span>
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
                <IconButton as={Link} to="/" size="compact" aria-label="Add workspace">
                  <Plus className="icon-compact shrink-0" />
                </IconButton>
              </Tooltip>
            </div>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {isDraggingOverSidebar && (
          <div className="border-accent/40 bg-surface-secondary text-role-control text-text-main pointer-events-none mb-3 flex items-center justify-center gap-2 rounded-lg border border-dashed p-3">
            <FolderUp className="h-4 w-4 shrink-0" />
            <span>Drop folder to open workspace</span>
          </div>
        )}
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
            providersById={providersById}
            handlePinSession={handlePinSession}
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
