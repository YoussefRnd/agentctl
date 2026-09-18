import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, ArrowLeft } from 'lucide-react';
import {
  createProjectSession,
  openProjectSession,
  type SidebarProject,
} from '@agentctl/api-client';
import { AppShell, Sidebar } from '@/app/shell';
import { projectQueries, DirectoryExplorer } from '@/features/projects';
import {
  SessionConfigProvider,
  SessionStreamProvider,
  useSession,
  useSessionActions,
} from '@/features/sessions';
import { NewSessionEmptyState } from '@/features/conversation';
import { CommandBar } from '@/features/composer';

interface HomeWorkspaceContentProps {
  projects: SidebarProject[];
  activeProject: SidebarProject;
  onSelectProject: (id: string) => void;
  onOpenDirectory: () => void;
}

function HomeWorkspaceContent({
  projects,
  activeProject,
  onSelectProject,
  onOpenDirectory,
}: HomeWorkspaceContentProps) {
  const navigate = useNavigate();
  const { sessionId } = useSession();
  const { handleSend } = useSessionActions();

  return (
    <div className="relative flex h-full w-full flex-1 flex-col items-center justify-center overflow-y-auto select-none">
      <NewSessionEmptyState
        projectName={activeProject.name}
        allowProjectSwitch={true}
        projects={projects}
        onSelectProject={onSelectProject}
        onOpenDirectory={onOpenDirectory}
      >
        <CommandBar
          variant="hero"
          onSend={(val, attachmentIds) => {
            void handleSend(val, attachmentIds);
            void navigate(`/sessions/${sessionId}`);
          }}
        />
      </NewSessionEmptyState>
    </div>
  );
}

export function HomeRoute() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [showExplorer, setShowExplorer] = useState(false);

  const { data: projects = [], isLoading: isLoadingProjects } = useQuery(projectQueries.all());

  const activeProject =
    projects.find((p) => p.id === selectedProjectId) ?? (projects.length > 0 ? projects[0] : null);

  const { data: activeSession, isLoading: isLoadingSession } = useQuery({
    queryKey: ['home-active-session', activeProject?.id],
    queryFn: async () => {
      if (!activeProject) return null;
      const existingEmpty = activeProject.sessions?.find(
        (s) =>
          s.status !== 'running' &&
          (!s.lastActivityAt || s.title === 'New Session' || s.title.startsWith('new-session')),
      );
      if (existingEmpty) {
        return existingEmpty;
      }
      return createProjectSession(activeProject.id);
    },
    enabled: !!activeProject && !showExplorer,
    staleTime: Infinity,
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
      {isLoadingProjects ? (
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
                className="text-text-muted hover:text-text-main flex cursor-pointer items-center gap-1.5 text-xs font-medium transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                <span>Back to workspace</span>
              </button>
            )}
            <DirectoryExplorer
              onSelect={async (dirPath: string) => {
                const res = await openProjectSession(dirPath, 'worktree');
                await queryClient.invalidateQueries({ queryKey: ['projects'] });
                setShowExplorer(false);
                void navigate(`/sessions/${res.session.id}`);
              }}
            />
          </div>
        </div>
      ) : isLoadingSession || !activeSession || !activeProject ? (
        <div className="flex h-full w-full items-center justify-center">
          <Loader2 className="text-accent h-6 w-6 animate-spin" />
        </div>
      ) : (
        <SessionConfigProvider key={`config-${activeSession.id}`} sessionId={activeSession.id}>
          <SessionStreamProvider key={`stream-${activeSession.id}`} sessionId={activeSession.id}>
            <HomeWorkspaceContent
              projects={projects}
              activeProject={activeProject}
              onSelectProject={(id) => setSelectedProjectId(id)}
              onOpenDirectory={() => setShowExplorer(true)}
            />
          </SessionStreamProvider>
        </SessionConfigProvider>
      )}
    </AppShell>
  );
}
