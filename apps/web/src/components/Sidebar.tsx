import { Folder, PlayCircle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';

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
  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => apiClient.fetch<Project[]>('/api/projects')
  });

  if (isLoading) return <div className="p-4 text-text-muted">Loading...</div>;

  return (
    <div className="w-64 bg-surface border-r border-border h-full flex flex-col p-4">
      <div className="text-xs font-bold text-text-muted uppercase tracking-wider mb-4">Explorer</div>
      {projects.length === 0 ? (
        <div className="text-sm text-text-muted">No projects found. Add one via CLI.</div>
      ) : (
        projects.map((proj: Project) => (
          <div key={proj.id} className="mb-4">
            <div className="flex items-center text-accent font-semibold mb-2">
              <Folder className="w-4 h-4 mr-2" /> {proj.name}
            </div>
            <div className="pl-6 flex flex-col gap-2">
              {proj.sessions.map((s: Project['sessions'][0]) => (
                <div key={s.id} className="flex items-center text-sm cursor-pointer hover:text-white">
                  <PlayCircle className="w-3 h-3 mr-2 text-success" /> {s.taskSlug ?? s.branch}
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
