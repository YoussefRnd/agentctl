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

 const { data: projects = [], isLoading } = useQuery({
  queryKey: ['projects'],
  queryFn: () => apiClient.fetch<SidebarProject[]>('/api/projects'),
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
  running: 'bg-accent shadow-[0_0_8px_rgba(203,166,247,0.4)]',
  needs_attention: 'bg-warning shadow-[0_0_8px_rgba(250,179,135,0.4)]',
  idle: 'bg-surface-quaternary',
  error: 'bg-danger shadow-[0_0_8px_rgba(243,139,168,0.4)]',
  merged: 'bg-success/50',
  discarded: 'bg-surface-quaternary/40',
 };

 return (
   <aside
     aria-label="Main Sidebar"
     className="bg-transparent relative z-20 flex h-full w-full shrink-0 flex-col overflow-hidden"
   >
     <div className="px-4 mt-8 mb-2 space-y-6">
       <div className="relative group">
     <Search className="text-text-muted absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 transition-colors group-focus-within:text-accent" />
     <input
      ref={searchInputRef}
      type="text"
      placeholder="SEARCH..."
      value={searchQuery}
      onChange={(e) => {
       setSearchQuery(e.target.value);
      }}
      className="terminal-input w-full pl-9 !h-9 !text-[11px] bg-surface-secondary/30 border-border/40 focus:border-accent/40"
     />
     <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-20 pointer-events-none group-focus-within:opacity-0 transition-opacity">
      <span className="text-[9px] font-mono border border-text-muted rounded px-1">⌘K</span>
     </div>
    </div>

    <div className="flex items-center justify-between">
     <h3 className="text-text-main text-[9px] font-black tracking-[0.25em] uppercase opacity-30">
      ::PROJECT_MANIFEST
     </h3>
     <div className="flex items-center gap-1">
      <Link
       to="/"
       className="hover:text-accent text-text-muted transition-all p-1 hover:bg-accent/10 rounded-sm"
       title="Add Project"
      >
       <Plus className="h-4 w-4" />
      </Link>
     </div>
    </div>
   </div>

   <div className="flex-1 overflow-y-auto px-2 pb-8 mt-2">
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
          className={`group flex cursor-pointer items-center justify-between rounded-sm px-2 py-1.5 transition-colors 
           ${!isCollapsed && proj.sessions.some((s) => s.id === activeSessionId) ? 'bg-surface-tertiary' : 'hover:bg-surface-secondary'}
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
           <span className="text-text-main truncate text-[12px] font-extrabold uppercase tracking-tight [@media(pointer:coarse)]:text-[14px]">
            {proj.name}
           </span>
          </div>
          <button
           type="button"
           className="hover:text-accent text-text-muted opacity-0 group-hover:opacity-100 disabled:opacity-50 [@media(pointer:coarse)]:opacity-100 [@media(pointer:coarse)]:p-2"
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
              className={`group ml-8 flex items-center border-l border-border/40 py-1.5 pr-2 pl-4 text-[11px] transition-all 
               ${activeSessionId === s.id ? 'bg-surface-secondary border-accent text-text-main font-bold' : 'text-text-muted hover:text-text-main hover:bg-surface-secondary/50'}
               [@media(pointer:coarse)]:py-3 [@media(pointer:coarse)]:pl-6 [@media(pointer:coarse)]:text-[13px]
              `}
             >
              <div
               className={`mr-2.5 h-1 w-1 shrink-0 rounded-full ${statusColors[s.status]}`}
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
     className="text-text-muted hover:text-accent hover:bg-surface-secondary group flex w-full items-center gap-2 rounded-sm p-1.5 text-[10px] font-bold uppercase tracking-tighter transition-all"
    >
     <Settings className="h-3 w-3" />
     Settings
    </Link>
   </div>
  </aside>
 );
}

