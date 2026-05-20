import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Folder,
  Plus,
  Search,
  ArrowUpDown,
  ChevronRight,
  ChevronDown,
  Loader2,
  Sparkles,
} from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiClient, createProjectSession, type SidebarProject } from '@agentctl/api-client';
import { useState, useMemo, useEffect, useRef, type MouseEvent } from 'react';
import type { DriverDiscovery, SessionStatus } from '@agentctl/shared';

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

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiClient.fetch<SidebarProject[]>('/api/projects'),
  });

  const { data: drivers = [] } = useQuery({
    queryKey: ['drivers'],
    queryFn: () => apiClient.fetch<DriverDiscovery[]>('/api/drivers'),
  });

  const createSessionMutation = useMutation({
    mutationFn: (projectId: string) => createProjectSession(projectId, drivers),
    onSuccess: (session) => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      void navigate(`/sessions/${session.id}`);
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Failed to create session');
    },
  });

  const filteredProjects = useMemo(() => {
    if (!searchQuery) return projects;
    const lowQuery = searchQuery.toLowerCase();
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(lowQuery) ||
        p.sessions.some((s) =>
          (s.title || s.taskSlug || s.branch || '').toLowerCase().includes(lowQuery),
        ),
    );
  }, [projects, searchQuery]);

  const toggleProject = (id: string) => {
    setCollapsedProjects((prev) => ({ ...prev, [id]: !(prev[id] ?? true) }));
  };

  const handleCreateSession = (event: MouseEvent, projectId: string) => {
    event.stopPropagation();
    createSessionMutation.mutate(projectId);
  };

  const statusColors: Record<SessionStatus, string> = {
    running: 'bg-success',
    needs_attention: 'bg-warning',
    idle: 'bg-text-muted',
    error: 'bg-danger',
    merged: 'bg-accent',
    discarded: 'bg-border',
  };

  return (
    <aside
      aria-label="Main Sidebar"
      className="liquid-glass border-border relative z-20 flex h-full w-[260px] shrink-0 flex-col overflow-hidden border-r shadow-[4px_0_24px_rgba(0,0,0,0.5)]"
    >
      <div className="from-glass-highlight/20 pointer-events-none absolute inset-0 bg-gradient-to-b to-transparent" />
      <div className="border-border/50 bg-background/20 relative z-10 space-y-4 border-b p-4 backdrop-blur-md">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-text-muted text-[10px] font-bold tracking-[0.2em] uppercase">
            AgentCTL
          </h2>
        </div>

        <div className="group relative">
          <Search className="text-text-muted group-focus-within:text-accent absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 transition-colors" />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
            }}
            className="bg-background/50 border-border focus:border-accent/50 focus:ring-accent/20 placeholder:text-text-muted/50 w-full rounded-lg border py-1.5 pr-10 pl-8 text-[12px] transition-all focus:ring-1 focus:outline-none"
          />
          <div className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-1">
            <kbd className="text-text-muted/50 border-border bg-surface/50 rounded border px-1 font-mono text-[9px]">
              Ctrl+K
            </kbd>
          </div>
        </div>
      </div>

      <div className="group flex items-center justify-between px-4 py-2">
        <h3 className="text-text-muted text-[10px] font-bold tracking-wider uppercase opacity-50">
          Projects
        </h3>
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            className="hover:bg-surface-hover text-text-muted rounded p-1 transition-colors"
            title="Sort Projects"
          >
            <ArrowUpDown className="h-3 w-3" />
          </button>
          <Link
            to="/"
            className="hover:bg-surface-hover text-text-muted rounded p-1 transition-colors"
            title="Add Project"
          >
            <Plus className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {isLoading ? (
          <div className="mt-2 space-y-3 px-2">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                aria-hidden="true"
                className="bg-border/40 h-3 w-full animate-pulse rounded"
              ></div>
            ))}
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="mt-4 px-2 text-center">
            <div className="text-text-muted text-[11px] italic">
              {searchQuery ? 'No results found.' : 'No projects found.'}
            </div>
          </div>
        ) : (
          <div className="space-y-0.5">
            {filteredProjects.map((proj) => {
              const isCollapsed = collapsedProjects[proj.id] ?? true;
              const showSessions = searchQuery ? true : !isCollapsed;
              const isCreatingSession =
                createSessionMutation.isPending && createSessionMutation.variables === proj.id;

              return (
                <div key={proj.id} className="space-y-0.5">
                  <div
                    className={`group flex cursor-pointer items-center justify-between rounded-lg px-2 py-1.5 transition-all duration-300 ${!isCollapsed && proj.sessions.some((s) => s.id === activeSessionId) ? 'bg-surface-hover/80 shadow-accent/5 shadow-md' : 'hover:bg-surface-hover/50 hover:-translate-y-[1px] hover:shadow-sm'}`}
                    onClick={() => {
                      toggleProject(proj.id);
                    }}
                  >
                    <div className="flex min-w-0 items-center">
                      <span className="mr-1 flex w-4 shrink-0 justify-center">
                        {isCollapsed ? (
                          <ChevronRight className="h-3 w-3 opacity-50" />
                        ) : (
                          <ChevronDown className="h-3 w-3 opacity-50" />
                        )}
                      </span>
                      <Folder className="text-text-muted group-hover:text-accent mr-2 h-3.5 w-3.5 shrink-0 transition-colors" />
                      <span className="font-display text-text-main/90 truncate text-[13px] font-medium">
                        {proj.name}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="hover:text-accent p-1 opacity-0 transition-all group-hover:opacity-100 disabled:opacity-50"
                      title={`New session in ${proj.name}`}
                      disabled={isCreatingSession}
                      onClick={(event) => {
                        handleCreateSession(event, proj.id);
                      }}
                    >
                      {isCreatingSession ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Plus className="h-3 w-3" />
                      )}
                    </button>
                  </div>

                  {showSessions && (
                    <div className="mt-0.5 space-y-0.5">
                      {proj.sessions.length === 0 ? (
                        <div className="text-text-muted/40 py-1 pl-9 text-[11px] italic">
                          No sessions yet
                        </div>
                      ) : (
                        proj.sessions.map((s) => (
                          <Link
                            key={s.id}
                            to={`/sessions/${s.id}`}
                            aria-current={activeSessionId === s.id ? 'page' : undefined}
                            className={`group ml-7 flex items-center rounded-md px-2 py-1.5 text-[12px] transition-all duration-300 ${activeSessionId === s.id ? 'bg-accent/15 text-accent font-semibold shadow-[0_0_10px_var(--color-accent-glow)]' : 'text-text-muted hover:text-text-main hover:bg-surface-hover/40'}`}
                          >
                            <div
                              className={`mr-2.5 h-1.5 w-1.5 shrink-0 rounded-full transition-all ${statusColors[s.status]} ${activeSessionId === s.id ? 'scale-110 shadow-[0_0_8px_currentColor]' : ''}`}
                            />
                            <span className="truncate">
                              {s.title || s.taskSlug || s.branch || 'New session'}
                            </span>
                          </Link>
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="border-border/50 bg-background/30 relative z-10 flex shrink-0 items-center justify-between border-t p-4">
        <Link
          to="/settings"
          className="text-text-muted hover:text-text-main hover:bg-surface-hover/50 group -mx-1 flex w-full items-center gap-2.5 rounded-xl p-2.5 text-xs font-semibold transition-all"
        >
          <div className="bg-surface-tertiary flex h-7 w-7 items-center justify-center rounded-lg border border-white/5 transition-all group-hover:border-white/10 group-hover:shadow-[0_0_10px_var(--color-accent-glow)]">
            <Sparkles className="text-text-muted group-hover:text-accent h-3.5 w-3.5 transition-colors" />
          </div>
          Settings
        </Link>
      </div>
    </aside>
  );
}
