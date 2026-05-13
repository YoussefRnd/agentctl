import { Link, useParams } from 'react-router-dom';
import { Folder, PlayCircle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client.js';

interface Project {
  id: string;
  name: string;
  sessions: {
    id: string;
    taskSlug?: string | null;
    branch?: string | null;
  }[];
}

export function Sidebar() {
  const { sessionId: activeSessionId } = useParams();
  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiClient.fetch<Project[]>('/api/projects')
  });

  return (
    <div className="w-64 bg-surface/50 backdrop-blur-md border-l border-border h-full flex flex-col p-4">
      <div className="text-xs font-bold text-text-muted uppercase tracking-wider mb-4">Explorer</div>
      {projects.map((proj) => (
        <div key={proj.id} className="mb-4">
          <div className="flex items-center text-accent font-semibold mb-2">
            <Folder className="w-4 h-4 mr-2" /> {proj.name}
          </div>
          <div className="pl-6 flex flex-col gap-2">
            {proj.sessions.map((s) => (
              <Link 
                key={s.id} 
                to={`/sessions/${s.id}`}
                className={`flex items-center text-sm cursor-pointer hover:text-white ${activeSessionId === s.id ? 'text-white' : 'text-text-muted'}`}
              >
                <PlayCircle className={`w-3 h-3 mr-2 ${activeSessionId === s.id ? 'text-accent' : 'text-success'}`} /> 
                {s.taskSlug ?? s.branch}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
