import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DirectoryExplorer } from './DirectoryExplorer';
import {
  AlertCircle,
  Loader2,
  Folder,
  FolderPlus,
  Clock,
  ChevronRight,
  ArrowLeft,
} from 'lucide-react';
import { apiClient, openProjectSession, type SidebarProject } from '@agentctl/api-client';
import { Button, GlassPanel } from '@agentctl/ui';

function formatRelativeTime(dateInput?: string | Date | null): string {
  if (!dateInput) return 'No recent activity';
  const date = new Date(dateInput);
  if (isNaN(date.getTime())) return 'No recent activity';

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0) return 'Just now';

  const diffSecs = Math.floor(diffMs / 1000);
  if (diffSecs < 60) return 'Just now';

  const diffMins = Math.floor(diffSecs / 60);
  if (diffMins < 60) return `${String(diffMins)}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${String(diffHours)}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${String(diffDays)}d ago`;

  const diffMonths = Math.floor(diffDays / 30);
  return `${String(diffMonths)}mo ago`;
}

function getLastActiveTimestamp(project: SidebarProject): string {
  if (project.sessions.length === 0) return 'No recent activity';
  let latest = 0;
  for (const s of project.sessions) {
    const time = new Date(s.updatedAt).getTime();
    if (!isNaN(time) && time > latest) {
      latest = time;
    }
  }
  return latest > 0 ? formatRelativeTime(new Date(latest)) : 'No recent activity';
}

function getActiveSessionCount(project: SidebarProject): number {
  return project.sessions.filter((s) => s.status !== 'archived' && s.status !== 'discarded').length;
}

export function NewProjectPalette() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiClient.fetch<SidebarProject[]>('/api/projects'),
  });

  const mutation = useMutation({
    mutationFn: (path: string) => openProjectSession(path),
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
    <div className="relative flex flex-1 flex-col items-center justify-center overflow-y-auto bg-transparent p-6">
      <div className="relative z-10 flex w-full max-w-2xl flex-col items-center space-y-6">
        {mutation.isPending ? (
          <div className="flex flex-col items-center gap-4 py-12">
            <Loader2 className="text-accent h-8 w-8 animate-spin" />
            <div className="space-y-1 text-center">
              <h2 className="text-text-main text-xl font-semibold">Initializing workspace...</h2>
              <p className="text-text-muted text-xs">Preparing session context...</p>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-2 text-center">
              <h1 className="text-text-main text-3xl font-bold tracking-tight">
                Start collaboration
              </h1>
              <p className="text-text-muted max-w-md text-center text-xs">
                Choose an active project or open a new git repository to begin.
              </p>
            </div>

            {mutation.error && (
              <div className="border-danger/30 bg-danger/5 text-danger w-full max-w-xl rounded-xl border p-3.5 text-left text-xs">
                <div className="flex items-center gap-2 font-semibold">
                  <AlertCircle className="text-danger h-4 w-4 shrink-0" />
                  Failed to open project
                </div>
                <p className="text-danger/80 mt-1 text-[11px]">{mutation.error.message}</p>
              </div>
            )}

            {shouldShowExplorer ? (
              <div className="flex w-full flex-col items-center space-y-4">
                {projects.length > 0 && (
                  <div className="flex w-full max-w-xl justify-start">
                    <button
                      type="button"
                      onClick={() => {
                        setShowExplorer(false);
                      }}
                      className="text-text-muted hover:text-text-main flex cursor-pointer items-center gap-1.5 text-xs transition-colors"
                    >
                      <ArrowLeft className="h-3.5 w-3.5" />
                      Back to recent projects
                    </button>
                  </div>
                )}
                <DirectoryExplorer onSelect={handleFolderSelect} />
              </div>
            ) : (
              <div className="w-full space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-text-main text-sm font-semibold">Recent projects</h2>
                  <Button
                    onClick={() => {
                      setShowExplorer(true);
                    }}
                    size="sm"
                    className="h-8 cursor-pointer gap-2 px-3 text-xs font-medium"
                  >
                    <FolderPlus className="h-3.5 w-3.5" />
                    Open Directory
                  </Button>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {projects.map((proj) => {
                    const activeCount = getActiveSessionCount(proj);
                    const lastActive = getLastActiveTimestamp(proj);

                    return (
                      <GlassPanel
                        key={proj.id}
                        className="group border-border/40 hover:border-accent/40 bg-surface-secondary/20 hover:bg-surface-secondary/40 flex cursor-pointer flex-col justify-between rounded-xl p-4 transition-all duration-200"
                      >
                        <div
                          onClick={() => {
                            handleFolderSelect(proj.path);
                          }}
                          className="flex flex-col space-y-2.5"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-2.5">
                              <div className="bg-surface-secondary/60 text-accent shrink-0 rounded-lg p-2">
                                <Folder className="h-4 w-4" />
                              </div>
                              <span className="text-text-main group-hover:text-accent truncate text-[14px] font-semibold transition-colors">
                                {proj.name}
                              </span>
                            </div>
                            <ChevronRight className="text-text-muted group-hover:text-accent h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
                          </div>

                          <p className="text-text-muted truncate font-mono text-[11px] opacity-70">
                            {proj.path}
                          </p>
                        </div>

                        <div className="border-border/20 text-text-muted mt-4 flex items-center justify-between border-t pt-3 text-[11px]">
                          <span className="flex items-center gap-1.5">
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${
                                activeCount > 0 ? 'bg-emerald-500' : 'bg-surface-tertiary'
                              }`}
                            />
                            {activeCount} {activeCount === 1 ? 'active session' : 'active sessions'}
                          </span>
                          <span className="flex items-center gap-1 opacity-80">
                            <Clock className="h-3 w-3" />
                            {lastActive}
                          </span>
                        </div>
                      </GlassPanel>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
