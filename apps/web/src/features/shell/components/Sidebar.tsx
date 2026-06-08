import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Folder,
  Plus,
  Search,
  ChevronRight,
  ChevronDown,
  Loader2,
  Settings,
  Trash2,
  Archive,
  ListFilter,
} from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  apiClient,
  createProjectSession,
  type SidebarProject,
  deleteProject,
  deleteSession,
  archiveSession,
} from '@agentctl/api-client';
import { useState, useMemo, useEffect, useRef, type MouseEvent } from 'react';
import type { ProviderDiscovery, SessionStatus } from '@agentctl/shared';

export function Sidebar() {
  const { sessionId: activeSessionId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [collapsedProjects, setCollapsedProjects] = useState<Partial<Record<string, boolean>>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const [sortBy, setSortBy] = useState<'lastActive' | 'name' | 'createdAt'>('lastActive');
  const [gitOnly, setGitOnly] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [isFilterMenuOpen, setIsFilterMenuOpen] = useState(false);
  const [confirmConfig, setConfirmConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    confirmText?: string;
    cancelText?: string;
    type?: 'danger' | 'warning' | 'info';
  } | null>(null);

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['projects', sortBy, gitOnly],
    queryFn: () => {
      const params = new URLSearchParams();
      params.append('sortBy', sortBy);
      if (gitOnly) params.append('gitOnly', 'true');
      return apiClient.fetch<SidebarProject[]>(`/api/projects?${params.toString()}`);
    },
  });

  const { data: providers = [] } = useQuery({
    queryKey: ['providers'],
    queryFn: () => apiClient.fetch<ProviderDiscovery[]>('/api/providers'),
  });

  const createSessionMutation = useMutation({
    mutationFn: (projectId: string) => createProjectSession(projectId, providers),
    onSuccess: (session) => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      void navigate(`/sessions/${session.id}`);
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Failed to create session');
    },
  });

  const deleteProjectMutation = useMutation({
    mutationFn: (projectId: string) => deleteProject(projectId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      toast.success('Project removed successfully');
      void navigate('/');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Failed to remove project');
    },
  });

  const deleteSessionMutation = useMutation({
    mutationFn: (sessionId: string) => deleteSession(sessionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      toast.success('Session deleted');
      if (activeSessionId) {
        void navigate('/');
      }
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Failed to delete session');
    },
  });

  const archiveSessionMutation = useMutation({
    mutationFn: (sessionId: string) => archiveSession(sessionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      void queryClient.invalidateQueries({ queryKey: ['session', activeSessionId] });
      toast.success('Session archived');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Failed to archive session');
    },
  });

  const filteredProjects = useMemo(() => {
    const visibleProjects = projects.map((p) => ({
      ...p,
      sessions: p.sessions.filter((s) => showArchived || s.status !== 'archived'),
    }));

    if (!searchQuery) return visibleProjects;
    const lowQuery = searchQuery.toLowerCase();
    return visibleProjects.filter(
      (p) =>
        p.name.toLowerCase().includes(lowQuery) ||
        p.sessions.some((s) =>
          (s.title || s.taskSlug || s.branch || '').toLowerCase().includes(lowQuery),
        ),
    );
  }, [projects, searchQuery, showArchived]);

  const toggleProject = (id: string) => {
    setCollapsedProjects((prev) => ({ ...prev, [id]: !(prev[id] ?? true) }));
  };

  const handleCreateSession = (event: MouseEvent, projectId: string) => {
    event.stopPropagation();
    createSessionMutation.mutate(projectId);
  };

  const statusColors: Record<SessionStatus, string> = {
    running: 'bg-accent shadow-[0_0_8px_rgba(203,166,247,0.4)]',
    needs_attention: 'bg-warning shadow-[0_0_8px_rgba(250,179,135,0.4)]',
    idle: 'bg-surface-quaternary',
    error: 'bg-danger shadow-[0_0_8px_rgba(243,139,168,0.4)]',
    merged: 'bg-success/50',
    discarded: 'bg-surface-quaternary/40',
    archived: 'bg-surface-quaternary/20',
  };

  return (
    <aside
      aria-label="Main Sidebar"
      className="relative z-20 flex h-full w-full shrink-0 flex-col overflow-hidden bg-transparent"
    >
      <div className="mt-8 mb-2 space-y-6 px-4">
        <div className="group relative">
          <Search className="text-text-muted group-focus-within:text-accent absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 transition-colors" />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="SEARCH..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
            }}
            className="terminal-input bg-surface-secondary/30 border-border/40 focus:border-accent/40 !h-9 w-full pl-9 !text-[11px]"
          />
          <div className="pointer-events-none absolute top-1/2 right-3 flex -translate-y-1/2 items-center gap-1 opacity-20 transition-opacity group-focus-within:opacity-0">
            <span className="border-text-muted rounded border px-1 font-mono text-[9px]">⌘K</span>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <h3 className="text-text-main text-[9px] font-black tracking-[0.25em] uppercase opacity-30">
            ::PROJECT_MANIFEST
          </h3>
          <div className="relative flex items-center gap-1.5">
            <div className="group/tooltip relative">
              <button
                onClick={() => { setIsFilterMenuOpen(!isFilterMenuOpen); }}
                className={`hover:text-accent rounded-sm p-1 transition-all text-text-muted hover:bg-surface-secondary/40 border border-transparent hover:scale-105 active:scale-95 ${isFilterMenuOpen ? 'text-accent bg-accent/10 border-accent/20' : ''}`}
              >
                <ListFilter className="h-4 w-4" />
              </button>
              <div className="pointer-events-none absolute bottom-full mb-1.5 right-1/2 translate-x-1/2 opacity-0 translate-y-1 scale-95 group-hover/tooltip:opacity-100 group-hover/tooltip:translate-y-0 group-hover/tooltip:scale-100 transition-all duration-150 ease-out bg-surface-secondary/95 border border-border/80 text-text-main text-[8px] px-1.5 py-0.5 rounded font-mono uppercase tracking-wider whitespace-nowrap z-50 shadow-xl backdrop-blur-sm">
                Filter and Sort
              </div>
            </div>

            {isFilterMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-30"
                  onClick={() => { setIsFilterMenuOpen(false); }}
                />
                <div className="absolute top-full right-0 mt-1 z-40 w-48 rounded-xl border border-border/80 bg-surface-secondary/95 p-2.5 shadow-2xl font-mono text-[10px] backdrop-blur-md animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="mb-1.5 px-2 text-[8px] font-black tracking-[0.15em] text-text-muted uppercase opacity-40">
                    ::SORT_MODE
                  </div>
                  <div className="space-y-0.5">
                    {(['lastActive', 'name', 'createdAt'] as const).map((opt) => (
                      <button
                        key={opt}
                        onClick={() => {
                          setSortBy(opt);
                          setIsFilterMenuOpen(false);
                        }}
                        className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left hover:bg-surface-tertiary transition-colors ${sortBy === opt ? 'text-accent font-black' : 'text-text-muted hover:text-text-main font-bold'}`}
                      >
                        <span>
                          {opt === 'lastActive' ? 'LAST ACTIVE' : opt === 'name' ? 'NAME (A-Z)' : 'DATE CREATED'}
                        </span>
                        {sortBy === opt && <span className="text-[9px] text-accent">●</span>}
                      </button>
                    ))}
                  </div>

                  <div className="my-2 border-t border-border/30" />

                  <div className="mb-1.5 px-2 text-[8px] font-black tracking-[0.15em] text-text-muted uppercase opacity-40">
                    ::FILTER_CONDITIONS
                  </div>
                  <div className="space-y-1">
                    <button
                      onClick={() => { setGitOnly(!gitOnly); }}
                      className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left hover:bg-surface-tertiary transition-colors ${gitOnly ? 'text-accent font-black' : 'text-text-muted hover:text-text-main font-bold'}`}
                    >
                      <span>GIT REPOS ONLY</span>
                      <input
                        type="checkbox"
                        checked={gitOnly}
                        readOnly
                        className="accent-accent h-3 w-3 pointer-events-none rounded border-border"
                      />
                    </button>
                    <button
                      onClick={() => { setShowArchived(!showArchived); }}
                      className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left hover:bg-surface-tertiary transition-colors ${showArchived ? 'text-accent font-black' : 'text-text-muted hover:text-text-main font-bold'}`}
                    >
                      <span>SHOW ARCHIVED SESSIONS</span>
                      <input
                        type="checkbox"
                        checked={showArchived}
                        readOnly
                        className="accent-accent h-3 w-3 pointer-events-none rounded border-border"
                      />
                    </button>
                  </div>
                </div>
              </>
            )}

            <div className="group/tooltip relative">
              <Link
                to="/"
                className="hover:text-accent text-text-muted hover:bg-accent/10 rounded-sm p-1 transition-all border border-transparent hover:scale-105 active:scale-95 flex items-center justify-center"
              >
                <Plus className="h-4 w-4" />
              </Link>
              <div className="pointer-events-none absolute bottom-full mb-1.5 right-1/2 translate-x-1/2 opacity-0 translate-y-1 scale-95 group-hover/tooltip:opacity-100 group-hover/tooltip:translate-y-0 group-hover/tooltip:scale-100 transition-all duration-150 ease-out bg-surface-secondary/95 border border-border/80 text-text-main text-[8px] px-1.5 py-0.5 rounded font-mono uppercase tracking-wider whitespace-nowrap z-50 shadow-xl backdrop-blur-sm">
                Add Project
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-2 flex-1 overflow-y-auto px-2 pb-8">
        {isLoading ? (
          <div className="space-y-3 p-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="bg-text-main/5 h-2 w-full animate-pulse rounded-full" />
            ))}
          </div>
        ) : (
          <div className="space-y-1.5">
            {filteredProjects.map((proj) => {
              const isCollapsed = collapsedProjects[proj.id] ?? true;
              const showSessions = searchQuery ? true : !isCollapsed;
              const isCreatingSession =
                createSessionMutation.isPending && createSessionMutation.variables === proj.id;

              return (
                <div key={proj.id} className="space-y-1">
                  <div
                    className={`group flex cursor-pointer items-center justify-between rounded-sm px-2 py-1.5 transition-colors ${!isCollapsed && proj.sessions.some((s) => s.id === activeSessionId) ? 'bg-surface-tertiary' : 'hover:bg-surface-secondary'} [@media(pointer:coarse)]:px-3 [@media(pointer:coarse)]:py-3`}
                    onClick={() => {
                      toggleProject(proj.id);
                    }}
                  >
                    <div className="flex min-w-0 items-center">
                      <span className="mr-1.5 flex w-3 shrink-0 justify-center">
                        {isCollapsed ? (
                          <ChevronRight className="h-3 w-3 opacity-30" />
                        ) : (
                          <ChevronDown className="h-3 w-3 opacity-30" />
                        )}
                      </span>
                      <Folder className="text-text-muted mr-2 h-3.5 w-3.5 shrink-0" />
                      <span className="text-text-main truncate text-[12px] font-extrabold tracking-tight uppercase [@media(pointer:coarse)]:text-[14px]">
                        {proj.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <div className="group/tooltip relative">
                        <button
                          type="button"
                          className="hover:text-danger text-text-muted/60 disabled:opacity-50 p-0.5 rounded hover:bg-danger/10 hover:scale-105 active:scale-95"
                          onClick={(event) => {
                            event.stopPropagation();
                            setConfirmConfig({
                              isOpen: true,
                              title: 'REMOVE PROJECT',
                              message: `Are you sure you want to remove project "${proj.name}"? This will stop and clean up all its sessions, but will not delete your local files.`,
                              type: 'danger',
                              confirmText: 'REMOVE_PROJECT',
                              onConfirm: () => {
                                deleteProjectMutation.mutate(proj.id);
                                setConfirmConfig(null);
                              },
                            });
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                        <div className="pointer-events-none absolute bottom-full mb-1 right-0 opacity-0 translate-y-1 scale-95 group-hover/tooltip:opacity-100 group-hover/tooltip:translate-y-0 group-hover/tooltip:scale-100 transition-all duration-150 ease-out bg-surface-secondary/95 border border-border/80 text-text-main text-[7px] px-1 py-0.5 rounded font-mono uppercase tracking-wider whitespace-nowrap z-50 shadow-xl backdrop-blur-sm">
                          Remove
                        </div>
                      </div>

                      <div className="group/tooltip relative">
                        <button
                          type="button"
                          className="hover:text-accent text-text-muted/60 disabled:opacity-50 p-0.5 rounded hover:bg-accent/10 hover:scale-105 active:scale-95"
                          disabled={isCreatingSession}
                          onClick={(event) => {
                            handleCreateSession(event, proj.id);
                          }}
                        >
                          {isCreatingSession ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Plus className="h-3.5 w-3.5" />
                          )}
                        </button>
                        <div className="pointer-events-none absolute bottom-full mb-1 right-0 opacity-0 translate-y-1 scale-95 group-hover/tooltip:opacity-100 group-hover/tooltip:translate-y-0 group-hover/tooltip:scale-100 transition-all duration-150 ease-out bg-surface-secondary/95 border border-border/80 text-text-main text-[7px] px-1 py-0.5 rounded font-mono uppercase tracking-wider whitespace-nowrap z-50 shadow-xl backdrop-blur-sm">
                          New Session
                        </div>
                      </div>
                    </div>
                  </div>

                  {showSessions && (
                    <div
                      className="grid overflow-hidden transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
                      style={{ gridTemplateRows: isCollapsed ? '0fr' : '1fr' }}
                    >
                      <div className="min-h-0 space-y-px">
                        {proj.sessions.map((s) => (
                          <div
                            key={s.id}
                            className={`group/session border-border/40 ml-8 flex items-center justify-between border-l text-[11px] transition-all hover:bg-surface-secondary/50 ${activeSessionId === s.id ? 'bg-surface-secondary border-accent text-text-main font-bold' : 'text-text-muted hover:text-text-main'} [@media(pointer:coarse)]:text-[13px]`}
                          >
                            <Link
                              to={`/sessions/${s.id}`}
                              className="flex-1 flex items-center py-1.5 pr-2 pl-4 min-w-0"
                            >
                              <div
                                className={`mr-2.5 h-1.5 w-1.5 shrink-0 rounded-full ${statusColors[s.status]}`}
                              />
                              <span className={`truncate tracking-tight uppercase ${s.status === 'archived' ? 'line-through opacity-50' : ''}`}>
                                {s.title || s.taskSlug || s.branch || 'NEW_SESSION'}
                              </span>
                            </Link>

                            <div className="flex items-center gap-1 pr-2 opacity-0 group-hover/session:opacity-100 transition-opacity">
                              {s.status !== 'archived' && (
                                <div className="group/tooltip relative">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      setConfirmConfig({
                                        isOpen: true,
                                        title: 'ARCHIVE SESSION',
                                        message: `Archive session "${s.title || s.taskSlug || 'this session'}"? This will remove its Git worktree on disk to free up space, but keep its history.`,
                                        type: 'warning',
                                        confirmText: 'ARCHIVE_SESSION',
                                        onConfirm: () => {
                                          archiveSessionMutation.mutate(s.id);
                                          setConfirmConfig(null);
                                        },
                                      });
                                    }}
                                    className="hover:text-warning text-text-muted/60 p-0.5 rounded hover:bg-warning/10 hover:scale-105 active:scale-95"
                                  >
                                    <Archive className="h-3 w-3" />
                                  </button>
                                  <div className="pointer-events-none absolute bottom-full mb-1 right-0 opacity-0 translate-y-1 scale-95 group-hover/tooltip:opacity-100 group-hover/tooltip:translate-y-0 group-hover/tooltip:scale-100 transition-all duration-150 ease-out bg-surface-secondary/95 border border-border/80 text-text-main text-[7px] px-1 py-0.5 rounded font-mono uppercase tracking-wider whitespace-nowrap z-50 shadow-xl backdrop-blur-sm">
                                    Archive
                                  </div>
                                </div>
                              )}
                              <div className="group/tooltip relative">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setConfirmConfig({
                                      isOpen: true,
                                      title: 'DELETE SESSION',
                                      message: `Permanently delete session "${s.title || s.taskSlug || 'this session'}" and all its logs? This cannot be undone.`,
                                      type: 'danger',
                                      confirmText: 'DELETE_SESSION',
                                      onConfirm: () => {
                                        deleteSessionMutation.mutate(s.id);
                                        setConfirmConfig(null);
                                      },
                                    });
                                  }}
                                  className="hover:text-danger text-text-muted/60 p-0.5 rounded hover:bg-danger/10 hover:scale-105 active:scale-95"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                                <div className="pointer-events-none absolute bottom-full mb-1 right-0 opacity-0 translate-y-1 scale-95 group-hover/tooltip:opacity-100 group-hover/tooltip:translate-y-0 group-hover/tooltip:scale-100 transition-all duration-150 ease-out bg-surface-secondary/95 border border-border/80 text-text-main text-[7px] px-1 py-0.5 rounded font-mono uppercase tracking-wider whitespace-nowrap z-50 shadow-xl backdrop-blur-sm">
                                  Delete
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="border-border/50 relative z-10 mt-auto border-t p-2">
        <Link
          to="/settings"
          className="text-text-muted hover:text-accent hover:bg-surface-secondary group flex w-full items-center gap-2 rounded-sm p-1.5 text-[10px] font-bold tracking-tighter uppercase transition-all"
        >
          <Settings className="h-3 w-3" />
          Settings
        </Link>
      </div>

      {confirmConfig && confirmConfig.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200">
          <div className="terminal-glass bg-surface-secondary/95 w-full max-w-sm rounded-lg p-5 shadow-2xl font-mono text-[10px] animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-2 mb-3">
              <span className={`text-[11px] font-black tracking-widest uppercase ${confirmConfig.type === 'danger' ? 'text-danger' : confirmConfig.type === 'warning' ? 'text-warning' : 'text-accent'}`}>
                :: {confirmConfig.title}
              </span>
            </div>

            <p className="text-text-muted leading-relaxed mb-6 font-bold uppercase tracking-tight">
              {confirmConfig.message}
            </p>

            <div className="flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => { setConfirmConfig(null); }}
                className="h-8 px-3.5 border border-border/40 hover:bg-surface-tertiary rounded text-text-muted hover:text-text-main font-black uppercase transition-all tracking-tight cursor-pointer"
              >
                {confirmConfig.cancelText ?? 'CANCEL'}
              </button>
              <button
                type="button"
                onClick={confirmConfig.onConfirm}
                className={`h-8 px-3.5 rounded font-black uppercase transition-all tracking-tight cursor-pointer active:scale-95 ${confirmConfig.type === 'danger' ? 'bg-danger text-background hover:bg-danger/90' : confirmConfig.type === 'warning' ? 'bg-warning text-background hover:bg-warning/90' : 'bg-accent text-background hover:bg-accent/90'}`}
              >
                {confirmConfig.confirmText ?? 'PROCEED'}
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
