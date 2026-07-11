import { Link, useNavigate, useParams } from 'react-router-dom';
import { Plus, Settings, ListFilter } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  apiClient,
  createProjectSession,
  type SidebarProject,
  deleteProject,
  deleteSession,
  archiveSession,
} from '@agentctl/api-client';
import { useState, useEffect, useRef } from 'react';
import { ConfirmationModal, SearchBar, Switch, Tooltip } from '@agentctl/ui';
import { useFilteredProjects } from '../hooks/useFilteredProjects.js';
import { useActionDispatcher } from '../../../hooks/useActionDispatcher';
import { useActionStore } from '../../../hooks/useActionStore';
import { useProjectStore } from '../../../contexts/ProjectContext';
import { ProjectItem } from './ProjectItem';

export function Sidebar() {
  const { sessionId: activeSessionId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { execute } = useActionDispatcher();
  const pendingActions = useActionStore((state) => state.pendingActions);
  const { settings, setSettings } = useProjectStore();
  const { sortBy, gitOnly, showArchived } = settings;

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

  const [isFilterMenuOpen, setIsFilterMenuOpen] = useState(false);
  const [confirmConfig, setConfirmConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    confirmText?: string;
    cancelText?: string;
    type?: 'brand-red' | 'brand-peach' | 'info';
  } | null>(null);

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['projects', sortBy, gitOnly],
    queryFn: () =>
      apiClient.fetch<SidebarProject[]>(
        `/api/projects?sortBy=${sortBy}&gitOnly=${gitOnly ? 'true' : 'false'}`,
      ),
  });

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
        if (activeSessionId === sessionId) {
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

  const filteredProjects = useFilteredProjects(projects, { searchQuery, showArchived });
  const toggleProject = (id: string) => {
    setCollapsedProjects((prev) => ({ ...prev, [id]: !(prev[id] ?? true) }));
  };

  return (
    <aside
      aria-label="Main Sidebar"
      className="relative z-20 flex h-full w-full shrink-0 flex-col overflow-hidden bg-transparent"
    >
      <div className="border-border/20 bg-surface-secondary/10 flex h-12 shrink-0 items-center border-b px-4">
        <span className="text-text-main text-[10px] font-black tracking-[0.2em] uppercase opacity-45 select-none">
          WORKSPACE
        </span>
      </div>

      <div className="mt-4 mb-2 space-y-6 px-4">
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
              <kbd className="bg-surface-secondary/80 border-border/50 text-text-muted rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold">
                ⌘K
              </kbd>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between">
          <h3 className="text-text-main text-[9px] font-semibold tracking-[0.15em] uppercase opacity-30">
            Projects
          </h3>
          <div className="relative flex items-center gap-1.5">
            <Tooltip content="Filter and Sort">
              <button
                type="button"
                onClick={() => {
                  setIsFilterMenuOpen(!isFilterMenuOpen);
                }}
                className={`hover:text-brand-mauve text-text-muted hover:bg-surface-secondary/40 rounded-sm border border-transparent p-1 transition-all hover:scale-105 active:scale-95 ${isFilterMenuOpen ? 'text-brand-mauve bg-brand-mauve/10 border-brand-mauve/20' : ''}`}
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
                <div className="border-border/80 bg-surface-secondary/95 animate-in fade-in slide-in-from-top-2 absolute top-full right-0 z-40 mt-1 w-48 rounded-xl border p-2.5 font-mono text-[10px] shadow-2xl backdrop-blur-md duration-200">
                  <div className="text-text-muted mb-1.5 px-2 text-[8px] font-semibold tracking-[0.12em] uppercase opacity-40">
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
                        className={`hover:bg-surface-tertiary flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left transition-colors ${sortBy === opt ? 'text-brand-mauve font-black' : 'text-text-muted hover:text-text-main font-bold'}`}
                      >
                        <span>
                          {opt === 'lastActive'
                            ? 'LAST ACTIVE'
                            : opt === 'name'
                              ? 'NAME (A-Z)'
                              : 'DATE CREATED'}
                        </span>
                        {sortBy === opt && <span className="text-brand-mauve text-[9px]">●</span>}
                      </button>
                    ))}
                  </div>

                  <div className="border-border/30 my-2 border-t" />

                  <div className="text-text-muted mb-1.5 px-2 text-[8px] font-semibold tracking-[0.12em] uppercase opacity-40">
                    Filter
                  </div>
                  <div className="space-y-1">
                    <button
                      type="button"
                      onClick={() => {
                        setSettings({ gitOnly: !gitOnly });
                      }}
                      className={`hover:bg-surface-tertiary flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left transition-colors ${gitOnly ? 'text-brand-mauve font-black' : 'text-text-muted hover:text-text-main font-bold'}`}
                    >
                      <span>GIT REPOS ONLY</span>
                      <Switch
                        checked={gitOnly}
                        size="sm"
                        aria-label="Git repos only"
                        className="pointer-events-none"
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSettings({ showArchived: !showArchived });
                      }}
                      className={`hover:bg-surface-tertiary flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left transition-colors ${showArchived ? 'text-brand-mauve font-black' : 'text-text-muted hover:text-text-main font-bold'}`}
                    >
                      <span>SHOW ARCHIVED SESSIONS</span>
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
              <div key={i} className="bg-text-main/5 h-2 w-full animate-pulse rounded-full" />
            ))}
          </div>
        ) : (
          <div className="space-y-1.5">
            {filteredProjects.map((proj) => (
              <ProjectItem
                key={proj.id}
                proj={proj}
                activeSessionId={activeSessionId}
                isCollapsed={collapsedProjects[proj.id] ?? true}
                searchQuery={searchQuery}
                isCreatingSession={pendingActions.has(`create-session-${proj.id}`)}
                pendingActions={pendingActions}
                toggleProject={toggleProject}
                setConfirmConfig={setConfirmConfig}
                handleDeleteProject={handleDeleteProject}
                handleCreateSession={handleCreateSession}
                handleArchiveSession={handleArchiveSession}
                handleDeleteSession={handleDeleteSession}
              />
            ))}
          </div>
        )}
      </div>

      <div className="border-border/50 relative z-10 mt-auto border-t p-2">
        <Link
          to="/settings"
          className="text-text-muted hover:text-brand-mauve hover:bg-surface-secondary group flex w-full items-center gap-2 rounded-sm p-1.5 text-[10px] font-bold tracking-tighter uppercase transition-all"
        >
          <Settings className="h-3.5 w-3.5" />
          Settings
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
    </aside>
  );
}
