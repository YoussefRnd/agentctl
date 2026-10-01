import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { openProjectFolder } from '@agentctl/api-client';
import { AppShell, Sidebar } from '@/app/shell';
import { projectQueries, DirectoryExplorer } from '@/features/projects';
import { NewSessionEmptyState } from '@/features/conversation';
import { DraftCommandBar, useHomeSessionStart } from '@/features/composer';

export function HomeRoute() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedProjectId = searchParams.get('project') ?? '';
  const setSelectedProjectId = (id: string) => {
    void setSearchParams({ project: id }, { replace: true });
  };
  const [showExplorer, setShowExplorer] = useState(false);
  const { data: projects = [], isLoading } = useQuery(projectQueries.all());
  const activeProject = projects.find((project) => project.id === selectedProjectId) ?? projects[0];
  const { startSession, isStarting } = useHomeSessionStart((sessionId) => {
    void navigate(`/sessions/${sessionId}`);
  });

  return (
    <AppShell
      nav={
        <div className="flex h-full w-full items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-text-muted/40">/</span>
            <span className="text-text-muted font-medium">Workspaces</span>
          </div>
        </div>
      }
      sidebar={<Sidebar />}
    >
      {isLoading ? (
        <div className="flex h-full w-full items-center justify-center">
          <Loader2 className="text-accent h-6 w-6 animate-spin" />
        </div>
      ) : showExplorer || projects.length === 0 ? (
        <div className="flex h-full w-full flex-col items-center justify-center overflow-y-auto p-4 py-8 select-none">
          <div className="w-full max-w-2xl space-y-4">
            {projects.length > 0 && (
              <button
                type="button"
                onClick={() => setShowExplorer(false)}
                className="text-text-muted hover:text-text-main flex cursor-pointer items-center gap-1.5 text-xs font-medium"
              >
                <ArrowLeft className="h-4 w-4" />
                <span>Back to workspace</span>
              </button>
            )}
            <DirectoryExplorer
              onSelect={async (dirPath) => {
                try {
                  const project = await openProjectFolder(dirPath);
                  await queryClient.invalidateQueries({ queryKey: ['projects'] });
                  setSelectedProjectId(project.id);
                  setShowExplorer(false);
                } catch (err) {
                  toast.error('Failed to open folder', {
                    description: err instanceof Error ? err.message : String(err),
                  });
                }
              }}
            />
          </div>
        </div>
      ) : activeProject ? (
        <div className="relative flex h-full w-full flex-1 flex-col items-center justify-center overflow-y-auto select-none">
          <NewSessionEmptyState
            onSelectStarterPrompt={(prompt) => {
              if (!isStarting)
                window.dispatchEvent(new CustomEvent('agentctl:edit-prompt', { detail: prompt }));
            }}
            projectName={activeProject.name}
            activeProjectId={activeProject.id}
            allowProjectSwitch
            projects={projects}
            onSelectProject={(id) => {
              if (!isStarting) setSelectedProjectId(id);
            }}
            onOpenDirectory={() => {
              if (!isStarting) setShowExplorer(true);
            }}
          >
            <DraftCommandBar
              key={activeProject.id}
              projectId={activeProject.id}
              canUseWorktree={activeProject.isGitRepo}
              disabled={isStarting}
              onSend={(text, files, selection) =>
                startSession(activeProject.id, text, files, selection)
              }
            />
          </NewSessionEmptyState>
        </div>
      ) : null}
    </AppShell>
  );
}
