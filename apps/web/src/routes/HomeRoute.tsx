import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, ArrowLeft } from 'lucide-react';
import { isDefaultSessionTitle } from '@agentctl/shared';
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
  initialInput?: string;
  onSelectProject: (id: string) => void;
  onOpenDirectory: () => void;
}

export interface SessionStartRequest {
  projectId: string;
  initialInput?: string;
}

export function findReusableDraftSession(project: SidebarProject) {
  return project.sessions?.find(
    (session) =>
      session.status === 'idle' &&
      (session.hasUserActivity === false ||
        (session.hasUserActivity === undefined &&
          isDefaultSessionTitle(session.title, session.taskSlug))),
  );
}

export function shouldCreateHomeSession(
  activeProjectId: string | undefined,
  hasReusableDraft: boolean,
) {
  return !!activeProjectId && !hasReusableDraft;
}

function StartSessionLauncher({
  projects,
  activeProject,
  isStarting,
  onSelectProject,
  onOpenDirectory,
  onStart,
}: HomeWorkspaceContentProps & {
  isStarting: boolean;
  onStart: (initialInput?: string) => void;
}) {
  return (
    <div className="relative flex h-full w-full flex-1 flex-col items-center justify-center overflow-y-auto select-none">
      <NewSessionEmptyState
        projectName={activeProject.name}
        activeProjectId={activeProject.id}
        allowProjectSwitch={true}
        projects={projects}
        onSelectProject={onSelectProject}
        onOpenDirectory={onOpenDirectory}
        onSelectStarterPrompt={(prompt) => onStart(prompt)}
      >
        <button
          type="button"
          onClick={() => onStart()}
          disabled={isStarting}
          className="border-border/40 bg-surface-secondary/50 hover:border-accent/50 focus-visible:ring-accent/40 group flex min-h-36 w-full cursor-text flex-col items-stretch overflow-hidden rounded-2xl border text-left shadow-2xl ring-1 ring-white/5 backdrop-blur-2xl transition-[border-color,background-color,box-shadow,opacity] duration-200 ease-out focus-visible:ring-2 focus-visible:outline-none disabled:cursor-wait disabled:opacity-60"
          aria-label="Start a new session"
        >
          <span className="text-text-muted/55 flex flex-1 items-start gap-3 px-5 py-4 text-[15px] leading-relaxed">
            <span className="text-text-muted group-hover:text-accent text-xl leading-5 transition-colors">
              +
            </span>
            <span>
              {isStarting
                ? 'Starting a new session...'
                : 'Start a session to ask for changes, send follow-ups, or attach images...'}
            </span>
          </span>
          <span className="border-border/20 text-text-muted/65 mx-5 flex h-12 items-center border-t text-xs font-medium">
            Session settings will appear here once you start.
          </span>
        </button>
      </NewSessionEmptyState>
    </div>
  );
}

function HomeWorkspaceContent({
  projects,
  activeProject,
  initialInput,
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
        activeProjectId={activeProject.id}
        allowProjectSwitch={true}
        projects={projects}
        onSelectProject={onSelectProject}
        onOpenDirectory={onOpenDirectory}
      >
        <CommandBar
          variant="hero"
          initialInput={initialInput}
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
  const [sessionStartRequest, setSessionStartRequest] = useState<SessionStartRequest | null>(null);

  const { data: projects = [], isLoading: isLoadingProjects } = useQuery(projectQueries.all());

  const activeProject =
    projects.find((p) => p.id === selectedProjectId) ?? (projects.length > 0 ? projects[0] : null);

  const reusableDraftSession = activeProject ? findReusableDraftSession(activeProject) : undefined;
  const shouldCreateSession = shouldCreateHomeSession(activeProject?.id, !!reusableDraftSession);

  const {
    data: createdSession,
    isLoading: isCreatingSession,
    isError: didCreateSessionFail,
    refetch: retryCreateSession,
  } = useQuery({
    queryKey: ['home-created-session', activeProject?.id],
    queryFn: async () => {
      if (!activeProject) return null;
      return createProjectSession(activeProject.id);
    },
    enabled: shouldCreateSession && !showExplorer,
    staleTime: Infinity,
    gcTime: 0,
  });

  const activeSession = reusableDraftSession ?? createdSession;
  const pendingInitialInput =
    activeProject && sessionStartRequest?.projectId === activeProject.id
      ? sessionStartRequest.initialInput
      : undefined;

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
      ) : !activeProject ? (
        <div className="flex h-full w-full items-center justify-center">
          <Loader2 className="text-accent h-6 w-6 animate-spin" />
        </div>
      ) : !activeSession ? (
        <StartSessionLauncher
          projects={projects}
          activeProject={activeProject}
          isStarting={isCreatingSession}
          onSelectProject={(id) => setSelectedProjectId(id)}
          onOpenDirectory={() => setShowExplorer(true)}
          onStart={(initialInput) => {
            setSessionStartRequest({ projectId: activeProject.id, initialInput });
            if (didCreateSessionFail) {
              void retryCreateSession();
            }
          }}
        />
      ) : (
        <SessionConfigProvider key={`config-${activeSession.id}`} sessionId={activeSession.id}>
          <SessionStreamProvider key={`stream-${activeSession.id}`} sessionId={activeSession.id}>
            <HomeWorkspaceContent
              projects={projects}
              activeProject={activeProject}
              initialInput={pendingInitialInput}
              onSelectProject={(id) => setSelectedProjectId(id)}
              onOpenDirectory={() => setShowExplorer(true)}
            />
          </SessionStreamProvider>
        </SessionConfigProvider>
      )}
    </AppShell>
  );
}
