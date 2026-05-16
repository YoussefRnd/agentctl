import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client.js';
import { DirectoryExplorer } from './DirectoryExplorer.js';
import { CommandBar } from './CommandBar.js';
import { Sparkles } from 'lucide-react';

interface CreateProjectResponse {
  project: { id: string; name: string; path: string };
}

interface CreateSessionResponse {
  id: string;
}

export function NewProjectPalette() {
  const navigate = useNavigate();
  const [projectPath, setProjectPath] = useState('');
  const [selectedHarnessId, setSelectedHarnessId] = useState<string | null>(null);
  const [isExplorerOpen, setIsExplorerOpen] = useState(false);

  const mutation = useMutation({
    mutationFn: async (payload: { path: string; selectedDriver: string; input: string }) => {
      // 1. Create project
      const { project } = await apiClient.fetch<CreateProjectResponse>('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ path: payload.path }),
      });

      // 2. Create session and send initial prompt
      const session = await apiClient.fetch<CreateSessionResponse>('/api/sessions', {
        method: 'POST',
        body: JSON.stringify({
          projectId: project.id,
          agent: payload.selectedDriver,
          taskSlug: payload.input.slice(0, 20).toLowerCase().replace(/\s+/g, '-'),
        }),
      });

      // Future: send initial message to websocket once navigated
      return session;
    },
    onSuccess: (data) => {
      void navigate(`/sessions/${data.id}`);
    },
  });

  const handleSend = (text: string) => {
    if (!projectPath) {
      setIsExplorerOpen(true);
      return;
    }
    if (!selectedHarnessId) {
      // Logic to remind user to pick a harness
      return;
    }
    mutation.mutate({ path: projectPath, selectedDriver: selectedHarnessId, input: text });
  };

  const handleFolderSelect = (path: string) => {
    setProjectPath(path);
    setIsExplorerOpen(false);
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-background relative">
      
      {/* Immersive Welcome Area */}
      <div className="flex-1 flex flex-col items-center justify-center p-8 max-w-2xl w-full text-center animate-in fade-in zoom-in-95 duration-1000">
        <div className="inline-flex p-5 rounded-[2rem] bg-accent/5 mb-10 shadow-inner">
          <Sparkles className="w-12 h-12 text-accent" />
        </div>
        <h1 className="text-5xl font-black mb-6 tracking-tight bg-gradient-to-b from-text-main to-text-main/60 bg-clip-text text-transparent">
          Agent Workbench
        </h1>
        <p className="text-text-muted text-xl mb-12 leading-relaxed font-medium">
          The command-first workspace for protocol-driven AI orchestration.
        </p>

        {projectPath && (
          <div className="px-4 py-2 bg-accent/10 border border-accent/20 rounded-full text-accent text-sm font-mono flex items-center gap-3 animate-in slide-in-from-top-2 duration-300">
            <span className="w-1.5 h-1.5 bg-accent rounded-full animate-pulse" />
            Active Folder: {projectPath}
          </div>
        )}
      </div>

      {/* Directory Explorer Overlay */}
      {isExplorerOpen && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-md p-8 animate-in fade-in duration-300">
          <div className="w-full max-w-xl">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold">Select Project</h2>
              <button 
                onClick={() => {
                  setIsExplorerOpen(false);
                }}
                className="text-text-muted hover:text-text-main transition-colors text-sm font-bold"
              >
                CLOSE
              </button>
            </div>
            <DirectoryExplorer onSelect={handleFolderSelect} />
          </div>
        </div>
      )}

      {/* Global Control Bar */}
      <div className="w-full max-w-5xl mx-auto px-4">
        <CommandBar 
          onSend={handleSend} 
          selectedHarnessId={selectedHarnessId}
          onHarnessSelect={(id) => {
            setSelectedHarnessId(id);
          }}
          disabled={mutation.isPending}
        />
      </div>
      
      {/* Background Ambience */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-accent/5 rounded-full blur-[120px] -z-10 pointer-events-none"></div>
    </div>
  );
}
