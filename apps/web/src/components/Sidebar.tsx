import { Link, useParams } from 'react-router-dom';
import { 
  Folder, 
  Plus, 
  Search,
  ArrowUpDown,
  Edit2,
  ChevronRight, 
  ChevronDown 
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client.js';
import { useState, useMemo, useEffect, useRef } from 'react';
import type { SessionStatus } from '@agentctl/shared';

interface Project {
  id: string;
  name: string;
  sessions: {
    id: string;
    title?: string | null;
    taskSlug?: string | null;
    branch?: string | null;
    status: SessionStatus;
  }[];
}

export function Sidebar() {
  const { sessionId: activeSessionId } = useParams();
  const [collapsedProjects, setCollapsedProjects] = useState<Record<string, boolean>>({});
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
    queryFn: () => apiClient.fetch<Project[]>('/api/projects')
  });

  const filteredProjects = useMemo(() => {
    if (!searchQuery) return projects;
    const lowQuery = searchQuery.toLowerCase();
    return projects.filter(p => 
      p.name.toLowerCase().includes(lowQuery) || 
      p.sessions.some(s => (s.title ?? s.taskSlug ?? s.branch ?? '').toLowerCase().includes(lowQuery))
    );
  }, [projects, searchQuery]);

  const toggleProject = (id: string) => {
    setCollapsedProjects(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const totalSessions = useMemo(() => 
    projects.reduce((acc, p) => acc + p.sessions.length, 0), 
    [projects]
  );

  const activeAgents = useMemo(() => 
    projects.reduce((acc, p) => 
      acc + p.sessions.filter(s => s.status === 'running').length, 0
    ), 
    [projects]
  );

  const statusColors: Record<SessionStatus, string> = {
    running: 'bg-success',
    needs_attention: 'bg-warning',
    idle: 'bg-text-muted',
    error: 'bg-danger',
    merged: 'bg-accent',
    discarded: 'bg-border'
  };

  return (
    <aside 
      aria-label="Main Sidebar"
      className="h-full w-[260px] shrink-0 liquid-glass border-r border-border flex flex-col overflow-hidden"
    >
      {/* Global Status */}
      <div className="px-4 pt-4 pb-2 flex items-center gap-4 border-b border-border/50 bg-glass-highlight">
        <div className="flex flex-col">
          <span className="text-[10px] text-text-muted uppercase tracking-tighter">Active Agents</span>
          <span className="text-sm font-display font-bold text-success">{activeAgents}</span>
        </div>
        <div className="h-6 w-px bg-border/50" />
        <div className="flex flex-col">
          <span className="text-[10px] text-text-muted uppercase tracking-tighter">Sessions</span>
          <span className="text-sm font-display font-bold text-text-main">{totalSessions}</span>
        </div>
      </div>

      {/* Brand & Search */}
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[10px] font-display font-bold text-text-muted uppercase tracking-[0.2em]">AgentCTL</h2>
          <div className="w-4 h-4 rounded-full border border-border flex items-center justify-center text-[10px] text-text-muted cursor-help">?</div>
        </div>

        <div className="relative group">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted group-focus-within:text-accent transition-colors" />
          <input 
            ref={searchInputRef}
            type="text" 
            placeholder="Search"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); }}
            className="w-full bg-background/50 border border-border rounded-lg py-1.5 pl-8 pr-10 text-[12px] focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all placeholder:text-text-muted/50"
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
            <kbd className="text-[9px] font-mono text-text-muted/50 border border-border px-1 rounded bg-surface/50">Ctrl+K</kbd>
          </div>
        </div>
      </div>

      {/* Projects Header */}
      <div className="px-4 py-2 flex items-center justify-between group">
        <h3 className="text-[10px] font-bold text-text-muted uppercase tracking-wider opacity-50">Projects</h3>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button className="p-1 hover:bg-surface-hover rounded transition-colors text-text-muted" title="Sort Projects">
            <ArrowUpDown className="w-3 h-3" />
          </button>
          <Link to="/" className="p-1 hover:bg-surface-hover rounded transition-colors text-text-muted" title="Add Project">
            <Plus className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      {/* Projects List */}
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
            {filteredProjects.map((proj) => (
              <div key={proj.id} className="space-y-0.5">
                <div 
                  className={`group flex items-center justify-between px-2 py-1 rounded-lg transition-all cursor-pointer ${!collapsedProjects[proj.id] && proj.sessions.some(s => s.id === activeSessionId) ? 'bg-surface-hover/50' : 'hover:bg-surface-hover/30'}`}
                  onClick={() => { toggleProject(proj.id); }}
                >
                  <div className="flex items-center min-w-0">
                    <span className="shrink-0 w-4 flex justify-center mr-1">
                      {collapsedProjects[proj.id] ? (
                        <ChevronRight className="w-3 h-3 opacity-50" />
                      ) : (
                        <ChevronDown className="w-3 h-3 opacity-50" />
                      )}
                    </span>
                    <Folder className="w-3.5 h-3.5 mr-2 text-text-muted group-hover:text-accent transition-colors shrink-0" />
                    <span className="truncate text-[13px] font-display font-medium text-text-main/90">{proj.name}</span>
                  </div>
                  <button className="opacity-0 group-hover:opacity-100 p-1 hover:text-accent transition-all">
                    <Edit2 className="w-3 h-3" />
                  </button>
                </div>

                {!collapsedProjects[proj.id] && (
                  <div className="space-y-0.5 mt-0.5">
                    {proj.sessions.length === 0 ? (
                      <div className="pl-9 py-1 text-[11px] text-text-muted/40 italic">No threads yet</div>
                    ) : (
                      proj.sessions.map((s) => (
                        <Link 
                          key={s.id} 
                          to={`/sessions/${s.id}`}
                          aria-current={activeSessionId === s.id ? 'page' : undefined}
                          className={`group flex items-center px-2 py-1 text-[12px] rounded-md transition-all ml-7 ${activeSessionId === s.id ? 'bg-accent/10 text-accent font-medium' : 'text-text-muted hover:text-text-main'}`}
                        >
                          <div className={`w-1.5 h-1.5 rounded-full mr-2.5 shrink-0 ${statusColors[s.status]}`} />
                          <span className="truncate">{s.title ?? s.taskSlug ?? s.branch}</span>
                        </Link>
                      ))
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
