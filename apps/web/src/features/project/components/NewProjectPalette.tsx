import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DirectoryExplorer } from './DirectoryExplorer';
import { AlertCircle } from 'lucide-react';
import type { DriverDiscovery } from '@agentctl/shared';
import { apiClient, openProjectSession, type SidebarProject } from '@agentctl/api-client';

export function NewProjectPalette() {
 const navigate = useNavigate();
 const queryClient = useQueryClient();

 const { data: drivers = [] } = useQuery({
  queryKey: ['drivers'],
  queryFn: () => apiClient.fetch<DriverDiscovery[]>('/api/drivers'),
 });

 const { data: projects = [] } = useQuery({
  queryKey: ['projects'],
  queryFn: () => apiClient.fetch<SidebarProject[]>('/api/projects'),
 });

 const mutation = useMutation({
  mutationFn: (path: string) => openProjectSession(path, drivers),
  onSuccess: (data) => {
   void queryClient.invalidateQueries({ queryKey: ['projects'] });
   void navigate(`/sessions/${data.session.id}`);
  },
 });

 const handleFolderSelect = (path: string) => {
  mutation.mutate(path);
 };

 const [showExplorer, setShowExplorer] = useState(false);

 const shouldShowExplorer = projects.length === 0 || showExplorer;

 return (
  <div className="bg-background relative flex flex-1 flex-col items-center justify-center overflow-hidden p-4">
   <div className="relative z-10 flex w-full max-w-2xl flex-col items-center space-y-6">
    {mutation.isPending ? (
     <div className="flex flex-col items-center gap-4">
      <div className="h-8 w-8 animate-spin border-4 border-accent border-t-transparent" />
      <p className="text-text-main text-xl font-black uppercase tracking-widest">
       INITIALIZING_WORKSPACE...
      </p>
      <p className="text-text-muted text-[11px] font-bold uppercase">PREPARING_SESSION_CONTEXT</p>
     </div>
    ) : (
     <>
      <h1 className="text-text-main text-3xl font-black uppercase tracking-widest text-center">
       AGENTCTL::START_COLLABORATION
      </h1>
      <p className="text-text-muted mb-8 text-[12px] font-bold uppercase tracking-tight text-center max-w-md">
       {shouldShowExplorer
        ? 'SELECT_GIT_PROJECT_DIRECTORY_TO_BEGIN_TASK_ORCHESTRATION.'
        : 'CHOOSE_ACTIVE_PROJECT_FROM_SIDEBAR_OR_OPEN_NEW_DIRECTORY.'}
      </p>

      {mutation.error && (
       <div className="border-danger/30 bg-danger/5 text-danger mb-4 rounded-sm border p-3 text-left text-[11px]">
        <div className="flex items-center gap-2 font-black uppercase">
         <AlertCircle className="h-3.5 w-3.5" />
         ERROR::MOUNT_FAILED
        </div>
        <p className="text-danger/80 mt-1 font-bold uppercase opacity-80">{mutation.error.message}</p>
       </div>
      )}

      {shouldShowExplorer ? (
       <DirectoryExplorer onSelect={handleFolderSelect} />
      ) : (
       <button
        onClick={() => {
         setShowExplorer(true);
        }}
        className="terminal-button !h-12 !px-8 text-[14px]"
       >
        OPEN_NEW_PROJECT
       </button>
      )}
     </>
    )}
   </div>
  </div>
 );
}

