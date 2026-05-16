import { Link, useParams } from 'react-router-dom';
import { Folder, PlayCircle, PlusCircle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client.js';

interface Project {
  id: string;
  name: string;
  sessions: {
    id: string;
    title?: string | null;
    taskSlug?: string | null;
    branch?: string | null;
  }[];
}

export function Sidebar() {
  const { sessionId: activeSessionId } = useParams();
  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiClient.fetch<Project[]>('/api/projects')
  });

  return (
    <aside className="h-64 w-full shrink-0 bg-surface/30 backdrop-blur-md p-4 overflow-y-auto lg:h-full lg:w-60 lg:border-r lg:border-border">
      <div className="flex items-center justify-between mb-6 px-1">
        <h2 className="text-[10px] font-bold text-text-muted uppercase tracking-[0.2em]">AgentCTL</h2>
        <Link to="/" className="text-text-muted hover:text-accent transition-colors">
          <PlusCircle className="w-4 h-4" />
        </Link>
      </div>
      
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-4 bg-border/40 rounded animate-pulse w-3/4"></div>
          ))}
        </div>
      ) : projects.length === 0 ? (
        <div className="text-[11px] text-text-muted italic px-2">No projects found.</div>
      ) : (
        <div className="space-y-6">
          {projects.map((proj) => (
            <div key={proj.id}>
              <div className="flex items-center text-[11px] font-medium text-text-muted mb-2 px-2 uppercase tracking-wider">
                <Folder className="w-3 h-3 mr-2 opacity-50" /> {proj.name}
              </div>
              <div className="space-y-1">
                {proj.sessions.map((s) => (
                  <Link 
                    key={s.id} 
                    to={`/sessions/${s.id}`}
                    aria-current={activeSessionId === s.id ? 'page' : undefined}
                    className={`group flex items-center text-[13px] cursor-pointer rounded-lg px-2 py-1.5 transition-all ${activeSessionId === s.id ? 'bg-accent/10 text-accent font-medium' : 'text-text-muted hover:bg-surface-hover hover:text-text-main'}`}
                  >
                    <PlayCircle className={`w-3.5 h-3.5 mr-2.5 transition-colors ${activeSessionId === s.id ? 'text-accent' : 'text-text-muted group-hover:text-success'}`} /> 
                    <span className="truncate">{s.title ?? s.taskSlug ?? s.branch}</span>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
