import { SidebarProjectSkeleton } from './ProjectItem';
import { Link } from 'react-router-dom';
import { AlertCircle, RefreshCw } from 'lucide-react';
import type { SidebarProject } from '@agentctl/api-client';
import type { ProviderDiscovery } from '@agentctl/shared';
import { Button, SkeletonSurface } from '@agentctl/ui';
import { ProjectItem } from './ProjectItem';

interface SidebarProjectListProps {
  providersById: ReadonlyMap<string, ProviderDiscovery>;
  handlePinSession: (id: string, pinned: boolean) => void;
  handleSettleSession: (id: string, settled: boolean) => void;
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
  providersById,
  handlePinSession,
  handleSettleSession,
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
      <SkeletonSurface message="Loading workspaces and sessions…" className="space-y-3 py-2">
        {[0, 1, 2].map((i) => (
          <SidebarProjectSkeleton key={i} />
        ))}
      </SkeletonSurface>
    );
  }

  if (isError) {
    return (
      <div className="border-border/40 my-3 space-y-2 rounded-lg border p-3 text-center">
        <div className="text-role-control text-text-main flex items-center justify-center gap-2">
          <AlertCircle className="icon-compact" />
          Failed to load workspaces
        </div>
        <Button
          type="button"
          variant="ghost"
          size="compact"
          onClick={() => {
            void refetch();
          }}
          className="gap-2"
        >
          <RefreshCw className="icon-compact" />
          Retry
        </Button>
      </div>
    );
  }

  if (filteredProjects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
        <p className="text-role-control text-text-muted">
          {searchQuery ? 'No matching sessions' : 'No workspaces yet'}
        </p>
        {!searchQuery && (
          <Link
            to="/"
            className="text-role-control text-accent motion-disclosure mt-2 underline underline-offset-2"
          >
            Add your first project
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {filteredProjects.map((proj) => {
        const hasActiveSession = proj.sessions.some((s) => s.id === currentActiveSessionId);
        const isCollapsed = collapsedProjects[proj.id] ?? !hasActiveSession;

        return (
          <ProjectItem
            key={proj.id}
            providersById={providersById}
            handlePinSession={handlePinSession}
            handleSettleSession={handleSettleSession}
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
