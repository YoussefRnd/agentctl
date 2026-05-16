import { Link, useParams } from 'react-router-dom';
import { 
  Folder, 
  PlusCircle, 
  Inbox, 
  Sparkles, 
  Repeat, 
  ChevronRight, 
  ChevronDown 
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client.js';
import { useState } from 'react';

interface Project {
  id: string;
  name: string;
  sessions: {
    id: string;
    title?: string | null;
    taskSlug?: string | null;
    branch?: string | null;
    status: 'running' | 'needs_attention' | 'idle' | 'error' | 'merged' | 'discarded';
  }[];
}

export function Sidebar() {
  const { sessionId: activeSessionId } = useParams();
  const [collapsedProjects, setCollapsedProjects] = useState<Record<string, boolean>>({});

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiClient.fetch<Project[]>('/api/projects')
  });

  const toggleProject = (id: string) => {
    setCollapsedProjects(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const statusColors: Record<string, string> = {
    running: 'bg-success',
    needs_attention: 'bg-warning',
    idle: 'bg-text-muted',
    error: 'bg-danger',
    merged: 'bg-accent',
    discarded: 'bg-border'
  };

  return (
    <aside className="h-full w-[260px] shrink-0 bg-surface/30 backdrop-blur-md border-r border-border flex flex-col overflow-hidden">
      {/* Brand */}
      <div className="p-4 flex items-center justify-between">
        <h2 className="text-[10px] font-bold text-text-muted uppercase tracking-[0.2em]">AgentCTL</h2>
        <Link to="/" className="text-text-muted hover:text-accent transition-colors">
          <PlusCircle className="w-4 h-4" />
        </Link>
      </div>

      {/* Global Apps */}
      <nav className="px-2 mb-4 space-y-0.5">
        <Link to="/inbox" className="flex items-center px-2 py-1.5 text-[13px] text-text-muted hover:bg-surface-hover hover:text-text-main rounded-md transition-all group">
          <Inbox className="w-4 h-4 mr-2.5 opacity-70 group-hover:opacity-100" />
          <span>Inbox</span>
        </Link>
        <Link to="/skills" className="flex items-center px-2 py-1.5 text-[13px] text-text-muted hover:bg-surface-hover hover:text-text-main rounded-md transition-all group">
          <Sparkles className="w-4 h-4 mr-2.5 opacity-70 group-hover:opacity-100" />
          <span>Skills</span>
        </Link>
        <Link to="/automations" className="flex items-center px-2 py-1.5 text-[13px] text-text-muted hover:bg-surface-hover hover:text-text-main rounded-md transition-all group">
          <Repeat className="w-4 h-4 mr-2.5 opacity-70 group-hover:opacity-100" />
          <span>Automations</span>
        </Link>
      </nav>

      {/* Projects */}
      <div className="flex-1 overflow-y-auto px-2 pb-4">
        <h3 className="px-2 mb-2 text-[10px] font-bold text-text-muted uppercase tracking-wider opacity-50">Projects</h3>
        
        {isLoading ? (
          <div className="px-2 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-3 bg-border/40 rounded animate-pulse w-full"></div>
            ))}
          </div>
        ) : projects.length === 0 ? (
          <div className="px-2 text-[11px] text-text-muted italic">No projects found.</div>
        ) : (
          <div className="space-y-1">
            {projects.map((proj) => (
              <div key={proj.id} className="space-y-0.5">
                <button 
                  onClick={() => { toggleProject(proj.id); }}
                  className="w-full flex items-center px-2 py-1 text-[11px] font-medium text-text-muted hover:text-text-main transition-colors group text-left"
                >
                  <span className="shrink-0 w-4 flex justify-center mr-1">
                    {collapsedProjects[proj.id] ? (
                      <ChevronRight className="w-3 h-3 opacity-50" />
                    ) : (
                      <ChevronDown className="w-3 h-3 opacity-50" />
                    )}
                  </span>
                  <Folder className="w-3 h-3 mr-2 opacity-50 group-hover:opacity-100 shrink-0" />
                  <span className="truncate">{proj.name}</span>
                </button>

                {!collapsedProjects[proj.id] && (
                  <div className="space-y-0.5">
                    {proj.sessions.map((s) => (
                      <Link 
                        key={s.id} 
                        to={`/sessions/${s.id}`}
                        aria-current={activeSessionId === s.id ? 'page' : undefined}
                        className={`group flex items-center px-2 py-1 text-[12px] rounded-md transition-all ml-4 ${activeSessionId === s.id ? 'bg-accent/10 text-accent font-medium' : 'text-text-muted hover:bg-surface-hover hover:text-text-main'}`}
                      >
                        <span className="mr-2 opacity-30 text-[10px] font-mono shrink-0">↳</span>
                        <div className={`w-1.5 h-1.5 rounded-full mr-2 shrink-0 ${statusColors[s.status] ?? 'bg-border'}`} />
                        <span className="truncate">{s.title ?? s.taskSlug ?? s.branch}</span>
                      </Link>
                    ))}
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
