import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client.js';
import { DirectoryExplorer } from './DirectoryExplorer.js';
import { Sparkles } from 'lucide-react';
import type { DriverDiscovery } from '@agentctl/shared';

interface CreateProjectResponse {
  project: { id: string; name: string; path: string };
}

interface CreateSessionResponse {
  id: string;
}

export function NewProjectPalette() {
  const navigate = useNavigate();

  const { data: drivers = [] } = useQuery({
    queryKey: ['drivers'],
    queryFn: () => apiClient.fetch<DriverDiscovery[]>('/api/drivers'),
  });

  const mutation = useMutation({
    mutationFn: async (path: string) => {
      const ready = drivers.find((d) => d.status === 'ready');
      const selectedDriver = ready?.id ?? 'opencode';

      const { project } = await apiClient.fetch<CreateProjectResponse>('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ path }),
      });

      return apiClient.fetch<CreateSessionResponse>('/api/sessions', {
        method: 'POST',
        body: JSON.stringify({
          projectId: project.id,
          agent: selectedDriver,
          taskSlug: 'setup',
        }),
      });
    },
    onSuccess: (data) => {
      void navigate(`/sessions/${data.id}`);
    },
  });

  const handleFolderSelect = (path: string) => {
    mutation.mutate(path);
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 bg-background relative overflow-hidden">
      <div className="max-w-2xl w-full text-center animate-in fade-in zoom-in-95 duration-1000 relative z-10">
        {mutation.isPending ? (
          <div className="flex flex-col items-center gap-6">
            <Sparkles className="w-12 h-12 text-accent animate-pulse" />
            <p className="text-2xl font-black tracking-tight text-text-main">Setting up your workspace...</p>
            <p className="text-text-muted">Creating project and initializing session</p>
          </div>
        ) : (
          <>
            <h1 className="text-5xl font-black mb-4 tracking-tight text-text-main">
              Welcome to Agent Workbench!
            </h1>
            <p className="text-text-muted text-lg mb-12">Pick a project folder and start collaborating with your agents.</p>
            <DirectoryExplorer onSelect={handleFolderSelect} />
          </>
        )}
      </div>
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1000px] h-[1000px] bg-accent/5 rounded-full blur-[150px] -z-0 pointer-events-none opacity-50" />
    </div>
  );
}
