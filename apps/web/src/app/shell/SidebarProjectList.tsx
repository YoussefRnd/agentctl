import { Link } from 'react-router-dom';
import { AlertCircle, RefreshCw } from 'lucide-react';
import type { SidebarProject } from '@agentctl/api-client';
import { ProjectItem } from './ProjectItem';

interface SidebarProjectListProps {
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
  filteredProjects: SidebarProject[];
  searchQuery: string;
  currentActiveSessionId?: string;
  collapsedProjects: Record<string, boolean>;
  pendingActions: Set<string>;
  toggleProject: (id: string, isCollapsed: boolean) => void;
  setConfirmConfig: (config: any) => void;
  handleDeleteProject: (projectId: string, projectName: string) => void;
  handleCreateSession: (projectId: string) => void;
  handleArchiveSession: (sessionId: string, title: string) => void;
  handleDeleteSession: (sessionId: string, title: string) => void;
  handleRenameSession: (sessionId: string, title: string) => void;
  handleForkSession: (sessionId: string, title: string) => void;
}

export function SidebarProjectList({
  isLoading,
  isError,
  refetch,
  filteredProjects,
  searchQuery,
  currentActiveSessionId,
  collapsedProjects,
  pendingActions,
  toggleProject,
  setConfirmConfig,
  handleDeleteProject,
  handleCreateSession,
  handleArchiveSession,
  handleDeleteSession,
  handleRenameSession,
  handleForkSession,
}: SidebarProjectListProps) {
  if (isLoading) {
    return (
      <div className="space-y-3 p-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="space-y-1.5">
            <div className="bg-surface-secondary/60 h-7 w-3/4 animate-pulse rounded-lg" />
            <div className="ml-4 space-y-1">
              <div className="bg-surface-secondary/40 h-6 w-5/6 animate-pulse rounded-md" />
              <div className="bg-surface-secondary/30 h-6 w-2/3 animate-pulse rounded-md" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="bg-danger/5 border-danger/20 my-3 space-y-2 rounded-xl border p-3 text-center">
        <div className="text-danger flex items-center justify-center gap-1.5 text-xs font-medium">
          <AlertCircle className="h-3.5 w-3.5" />
          Failed to load workspaces
        </div>
        <button
          type="button"
          onClick={() => {
            void refetch();
          }}
          className="bg-danger/10 hover:bg-danger/20 text-danger inline-flex cursor-pointer items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Retry
        </button>
      </div>
    );
  }

  if (filteredProjects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
        <p className="text-text-muted/60 text-xs font-medium">
          {searchQuery ? 'No matching sessions' : 'No workspaces yet'}
        </p>
        {!searchQuery && (
          <Link
            to="/"
            className="text-accent hover:text-accent/80 mt-2 text-xs font-medium underline underline-offset-2 transition-colors"
          >
            Add your first project
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {filteredProjects.map((proj) => {
        const hasActiveSession = proj.sessions.some((s) => s.id === currentActiveSessionId);
        const isCollapsed = collapsedProjects[proj.id] ?? !hasActiveSession;

        return (
          <ProjectItem
            key={proj.id}
            proj={proj}
            activeSessionId={currentActiveSessionId}
            isCollapsed={isCollapsed}
            searchQuery={searchQuery}
            isCreatingSession={pendingActions.has(`create-session-${proj.id}`)}
            pendingActions={pendingActions}
            toggleProject={toggleProject}
            setConfirmConfig={setConfirmConfig}
            handleDeleteProject={handleDeleteProject}
            handleCreateSession={handleCreateSession}
            handleArchiveSession={handleArchiveSession}
            handleDeleteSession={handleDeleteSession}
            handleRenameSession={handleRenameSession}
            handleForkSession={handleForkSession}
          />
        );
      })}
    </div>
  );
}
