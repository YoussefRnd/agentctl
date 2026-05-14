import { Link, useParams } from 'react-router-dom';
import { Folder, PlayCircle } from 'lucide-react';
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
    <aside className="h-64 w-full shrink-0 border-t border-border bg-surface/50 backdrop-blur-md p-4 overflow-y-auto lg:h-full lg:w-64 lg:border-t-0 lg:border-l">
      <h2 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-4">Explorer</h2>
      
      {isLoading ? (
        <div className="text-sm text-text-muted animate-pulse">Loading projects...</div>
      ) : projects.length === 0 ? (
        <div className="text-sm text-text-muted italic">No projects found.</div>
      ) : (
        projects.map((proj) => (
          <div key={proj.id} className="mb-4">
            <div className="flex items-center text-accent font-semibold mb-2">
              <Folder className="w-4 h-4 mr-2" /> {proj.name}
            </div>
            <div className="pl-6 flex flex-col gap-2">
              {proj.sessions.map((s) => (
                <Link 
                  key={s.id} 
                  to={`/sessions/${s.id}`}
                  aria-current={activeSessionId === s.id ? 'page' : undefined}
                  className={`flex items-center text-sm cursor-pointer rounded px-2 py-1 hover:text-white ${activeSessionId === s.id ? 'bg-background/40 text-white' : 'text-text-muted'}`}
                >
                  <PlayCircle className={`w-3 h-3 mr-2 ${activeSessionId === s.id ? 'text-accent' : 'text-success'}`} /> 
                  {s.title ?? s.taskSlug ?? s.branch}
                </Link>
              ))}
            </div>
          </div>
        ))
      )}
    </aside>
  );
}
