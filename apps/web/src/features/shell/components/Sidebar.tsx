import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Folder,
  Plus,
  Search,
  ArrowUpDown,
  ChevronRight,
  ChevronDown,
  Loader2,
} from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiClient } from '../../../api/api-client';
import { useState, useMemo, useEffect, useRef, type MouseEvent } from 'react';
import type { DriverDiscovery, SessionStatus } from '@agentctl/shared';
import { createProjectSession, type SidebarProject } from '../../../services/project-sessions';

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
      className="h-full w-[260px] shrink-0 liquid-glass border-r border-border flex flex-col overflow-hidden"
    >
      <div className="p-4 space-y-4 border-b border-border/50 bg-glass-highlight">
        <div className="flex items-center justify-between">
          <h2 className="text-[10px] font-display font-bold text-text-muted uppercase tracking-[0.2em]">
            AgentCTL
          </h2>
        </div>

        <div className="relative group">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted group-focus-within:text-accent transition-colors" />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
            }}
            className="w-full bg-background/50 border border-border rounded-lg py-1.5 pl-8 pr-10 text-[12px] focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all placeholder:text-text-muted/50"
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
            <kbd className="text-[9px] font-mono text-text-muted/50 border border-border px-1 rounded bg-surface/50">
              Ctrl+K
            </kbd>
          </div>
        </div>
      </div>

      <div className="px-4 py-2 flex items-center justify-between group">
        <h3 className="text-[10px] font-bold text-text-muted uppercase tracking-wider opacity-50">
          Projects
        </h3>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            className="p-1 hover:bg-surface-hover rounded transition-colors text-text-muted"
            title="Sort Projects"
          >
            <ArrowUpDown className="w-3 h-3" />
          </button>
          <Link
            to="/"
            className="p-1 hover:bg-surface-hover rounded transition-colors text-text-muted"
            title="Add Project"
          >
            <Plus className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {isLoading ? (
          <div className="px-2 space-y-3 mt-2">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                aria-hidden="true"
                className="h-3 bg-border/40 rounded animate-pulse w-full"
              ></div>
            ))}
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="px-2 mt-4 text-center">
            <div className="text-[11px] text-text-muted italic">
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
                    className={`group flex items-center justify-between px-2 py-1 rounded-lg transition-all cursor-pointer ${!isCollapsed && proj.sessions.some((s) => s.id === activeSessionId) ? 'bg-surface-hover/50' : 'hover:bg-surface-hover/30'}`}
                    onClick={() => {
                      toggleProject(proj.id);
                    }}
                  >
                    <div className="flex items-center min-w-0">
                      <span className="shrink-0 w-4 flex justify-center mr-1">
                        {isCollapsed ? (
                          <ChevronRight className="w-3 h-3 opacity-50" />
                        ) : (
                          <ChevronDown className="w-3 h-3 opacity-50" />
                        )}
                      </span>
                      <Folder className="w-3.5 h-3.5 mr-2 text-text-muted group-hover:text-accent transition-colors shrink-0" />
                      <span className="truncate text-[13px] font-display font-medium text-text-main/90">
                        {proj.name}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="opacity-0 group-hover:opacity-100 p-1 hover:text-accent transition-all disabled:opacity-50"
                      title={`New session in ${proj.name}`}
                      disabled={isCreatingSession}
                      onClick={(event) => {
                        handleCreateSession(event, proj.id);
                      }}
                    >
                      {isCreatingSession ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Plus className="w-3 h-3" />
                      )}
                    </button>
                  </div>

                  {showSessions && (
                    <div className="space-y-0.5 mt-0.5">
                      {proj.sessions.length === 0 ? (
                        <div className="pl-9 py-1 text-[11px] text-text-muted/40 italic">
                          No sessions yet
                        </div>
                      ) : (
                        proj.sessions.map((s) => (
                          <Link
                            key={s.id}
                            to={`/sessions/${s.id}`}
                            aria-current={activeSessionId === s.id ? 'page' : undefined}
                            className={`group flex items-center px-2 py-1 text-[12px] rounded-md transition-all ml-7 ${activeSessionId === s.id ? 'bg-accent/10 text-accent font-medium' : 'text-text-muted hover:text-text-main'}`}
                          >
                            <div
                              className={`w-1.5 h-1.5 rounded-full mr-2.5 shrink-0 ${statusColors[s.status]}`}
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
    </aside>
  );
}
