import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Folder,
  Plus,
  Search,
  ChevronRight,
  ChevronDown,
  Loader2,
  Settings,
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
    running: 'bg-white',
    needs_attention: 'bg-zinc-400',
    idle: 'bg-zinc-600',
    error: 'bg-white',
    merged: 'bg-zinc-200',
    discarded: 'bg-zinc-800',
  };

  return (
    <aside
      aria-label="Main Sidebar"
      className="terminal-glass relative z-20 flex h-full w-[220px] shrink-0 flex-col overflow-hidden border-r"
    >
      <div className="border-white/5 relative z-10 flex h-11 items-center gap-2 border-b px-3 py-1.5">
        <div className="flex shrink-0 items-center px-1">
          <h2 className="text-white text-[10px] font-black uppercase tracking-[0.2em]">
            AGENTCTL
          </h2>
        </div>
      </div>

      <div className="px-3 mt-6 mb-1">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white text-[10px] font-black tracking-widest uppercase opacity-30">
            ::PROJECT_MANIFEST
          </h3>
          <div className="flex items-center gap-1">
            <Link
              to="/"
              className="hover:text-text-main text-text-muted transition-colors p-1"
              title="Add Project"
            >
              <Plus className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>

        <div className="relative">
          <Search className="text-text-muted absolute top-1/2 left-2 h-3 w-3 -translate-y-1/2" />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="SEARCH..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
            }}
            className="terminal-input w-full pl-7 !h-7 !text-[11px]"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-1.5 pb-6 mt-4">
        {isLoading ? (
          <div className="space-y-1 p-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-white/5 h-2 w-full animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {filteredProjects.map((proj) => {
              const isCollapsed = collapsedProjects[proj.id] ?? true;
              const showSessions = searchQuery ? true : !isCollapsed;
              const isCreatingSession =
                createSessionMutation.isPending && createSessionMutation.variables === proj.id;

              return (
                <div key={proj.id} className="space-y-1">
                  <div
                    className={`group flex cursor-pointer items-center justify-between rounded-sm px-2 py-1.5 transition-colors 
                      ${!isCollapsed && proj.sessions.some((s) => s.id === activeSessionId) ? 'bg-white/10' : 'hover:bg-white/5'}
                      [@media(pointer:coarse)]:py-3 [@media(pointer:coarse)]:px-3
                    `}
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
                      <span className="text-white truncate text-[12px] font-black uppercase tracking-tight [@media(pointer:coarse)]:text-[14px]">
                        {proj.name}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="hover:text-white opacity-0 group-hover:opacity-100 disabled:opacity-50 [@media(pointer:coarse)]:opacity-100 [@media(pointer:coarse)]:p-2"
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
                  </div>

                  {showSessions && (
                    <div className="grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] overflow-hidden" style={{ gridTemplateRows: isCollapsed ? '0fr' : '1fr' }}>
                      <div className="min-h-0 space-y-px">
                        {proj.sessions.map((s) => (
                          <Link
                            key={s.id}
                            to={`/sessions/${s.id}`}
                            className={`group ml-8 flex items-center border-l border-white/5 py-1.5 pr-2 pl-4 text-[11px] transition-all 
                              ${activeSessionId === s.id ? 'bg-white/10 border-white/20 text-white font-bold' : 'text-text-muted hover:text-white hover:bg-white/5'}
                              [@media(pointer:coarse)]:py-3 [@media(pointer:coarse)]:pl-6 [@media(pointer:coarse)]:text-[13px]
                            `}
                          >
                            <div
                              className={`mr-2.5 h-1 w-1 shrink-0 ${statusColors[s.status]}`}
                            />
                            <span className="truncate uppercase tracking-tight">
                              {s.title || s.taskSlug || s.branch || 'NEW_SESSION'}
                            </span>
                          </Link>
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
          className="text-text-muted hover:text-text-main hover:bg-white/5 group flex w-full items-center gap-2 rounded-sm p-1.5 text-[10px] font-bold uppercase tracking-tighter transition-all"
        >
          <Settings className="h-3 w-3" />
          Settings
        </Link>
      </div>
    </aside>
  );
}

