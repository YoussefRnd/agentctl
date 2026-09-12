import { useState, useRef, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, MessageSquare, Folder, FolderUp } from 'lucide-react';
import type { SidebarProject } from '@agentctl/api-client';
import {
  apiClient,
  createProjectSession,
  openProjectSession,
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
    refetchInterval: (query) => {
      if (typeof document !== 'undefined' && document.hidden) return false;
      const data = query.state.data;
      const hasRunning = data?.some((p) => p.sessions?.some((s) => s.status === 'running'));
      return hasRunning ? 3000 : 10000;
    },
    refetchIntervalInBackground: false,
    staleTime: 2000,
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

  const [isDraggingOverSidebar, setIsDraggingOverSidebar] = useState(false);
  const dragCounter = useRef(0);

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    const types = Array.from(e.dataTransfer?.types || []);
    if (types.includes('Files') || types.includes('text/uri-list')) {
      dragCounter.current += 1;
      if (dragCounter.current === 1) {
        setIsDraggingOverSidebar(true);
      }
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) {
      setIsDraggingOverSidebar(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDraggingOverSidebar(false);

    const files = e.dataTransfer?.files;
    const firstFile = files?.[0];

    let resolvedPath: string | undefined = undefined;

    // 1. Electron webUtils API (if running in Electron)
    if (firstFile && window.electronAPI?.getPathForFile) {
      try {
        resolvedPath = window.electronAPI.getPathForFile(firstFile);
      } catch {
        // fallback
      }
    }

    // 2. Electron / node-enabled File.path
    if (
      !resolvedPath &&
      firstFile &&
      'path' in firstFile &&
      typeof (firstFile as { path?: string }).path === 'string' &&
      (firstFile as { path?: string }).path
    ) {
      resolvedPath = (firstFile as { path?: string }).path;
    }

    // 3. text/uri-list (Standard MIME type from OS file managers: Nautilus, Dolphin, macOS Finder)
    if (!resolvedPath && e.dataTransfer) {
      const uriList = e.dataTransfer.getData('text/uri-list');
      if (uriList) {
        const lines = uriList.split(/\r?\n/);
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#') && trimmed.startsWith('file://')) {
            try {
              const url = new URL(trimmed);
              let p = decodeURIComponent(url.pathname);
              if (/^\/[a-zA-Z]:/.test(p)) {
                p = p.slice(1);
              }
              if (p) {
                resolvedPath = p;
                break;
              }
            } catch {
              // continue
            }
          }
        }
      }
    }

    // 4. text/plain fallback (Raw file path or file:// URL)
    if (!resolvedPath && e.dataTransfer) {
      const textPlain = e.dataTransfer.getData('text/plain');
      if (textPlain) {
        const lines = textPlain.split(/\r?\n/);
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('file://')) {
            try {
              const url = new URL(trimmed);
              let p = decodeURIComponent(url.pathname);
              if (/^\/[a-zA-Z]:/.test(p)) {
                p = p.slice(1);
              }
              if (p) {
                resolvedPath = p;
                break;
              }
            } catch {
              // continue
            }
          } else if (trimmed.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(trimmed)) {
            resolvedPath = trimmed;
            break;
          }
        }
      }
    }

    // 5. Match against existing registered projects by folder name
    const folderName = firstFile?.name?.replace(/[\\/]$/, '');
    if (!resolvedPath && folderName && projects.length > 0) {
      const cleanName = folderName.toLowerCase();
      const match = projects.find(
        (p) =>
          p.name.toLowerCase() === cleanName ||
          p.path.toLowerCase().endsWith(`/${cleanName}`) ||
          p.path.toLowerCase().endsWith(`\\${cleanName}`),
      );
      if (match) {
        resolvedPath = match.path;
      }
    }

    // 6. Path to attempt opening: either full resolved path or the folder name (server searches candidate directories)
    const pathToOpen = resolvedPath || folderName;

    if (!pathToOpen) {
      toast.error('Unable to determine folder path');
      return;
    }

    try {
      const res = await openProjectSession(pathToOpen);
      if (res?.session?.id) {
        await queryClient.invalidateQueries({ queryKey: ['projects'] });
        void navigate(`/sessions/${res.session.id}`);
        toast.success('Workspace opened');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to open workspace';
      toast.error(msg);
      if (!resolvedPath) {
        void navigate('/');
      }
    }
  };

  return (
    <aside
      aria-label="Main Sidebar"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        'relative z-20 flex h-full w-full shrink-0 flex-col overflow-hidden bg-transparent transition-colors duration-150 select-none',
        isDraggingOverSidebar && 'ring-accent/20 bg-accent/[0.015] ring-1 ring-inset',
      )}
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
        {isDraggingOverSidebar && (
          <div className="border-accent/40 bg-accent/[0.04] text-accent ring-accent/20 animate-in fade-in slide-in-from-top-1 pointer-events-none mb-2.5 flex items-center justify-center gap-2 rounded-xl border border-dashed px-3 py-3 text-xs font-medium tracking-tight ring-1 backdrop-blur-xs transition-all duration-150">
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
