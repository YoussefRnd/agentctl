import { SidebarProjectGroupLayout, SidebarProjectHeaderLayout } from './SidebarRowLayouts';
import { useState, type ReactNode, type ComponentType } from 'react';
import type { ProviderDiscovery } from '@agentctl/shared';
import { SessionRow, SessionRowPresentation, type SessionRowProps } from './SessionRow';
import { Folder, FolderOpen, Plus, ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import type { SidebarProject } from '@agentctl/api-client';
import { IconButton, Tooltip, Spinner, SkeletonSurface } from '@agentctl/ui';
import { QuickLaunchSessionDialog } from '@/app/session/QuickLaunchSessionDialog';

interface ConfirmConfig {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  confirmText?: string;
  cancelText?: string;
  type?: 'brand-red' | 'brand-peach' | 'info';
}

interface ProjectItemProps {
  proj: SidebarProject;
  providersById: ReadonlyMap<string, ProviderDiscovery>;
  handlePinSession: (id: string, pinned: boolean) => void;
  handleSettleSession: (id: string, settled: boolean) => void;
  activeSessionId: string | undefined;
  isCollapsed: boolean;
  searchQuery: string;
  isCreatingSession: boolean;
  pendingActions: Set<string>;
  toggleProject: (projectId: string, isCollapsed: boolean) => void;
  setConfirmConfig: (config: ConfirmConfig | null) => void;
  handleDeleteProject: (projectId: string, projectName: string) => void;
  handleCreateSession: (projectId: string) => void;
  handleArchiveSession: (sessionId: string, title: string) => void;
  handleDeleteSession: (sessionId: string, title: string) => void;
  handleRenameSession: (sessionId: string, title: string) => void;
  handleForkSession: (sessionId: string, title: string) => void;
}

export function ProjectItem(props: ProjectItemProps) {
  return (
    <ProjectItemPresentation
      {...props}
      SessionRowComponent={SessionRow}
      renderQuickLaunch={(open, onClose) => (
        <QuickLaunchSessionDialog
          open={open}
          onClose={onClose}
          projectId={props.proj.id}
          projectName={props.proj.name}
          defaultMode={props.proj.isGitRepo ? undefined : 'local'}
          allowWorktree={props.proj.isGitRepo}
        />
      )}
    />
  );
}

export function ProjectItemPresentation({
  proj,
  providersById,
  handlePinSession,
  handleSettleSession,
  activeSessionId,
  isCollapsed,
  searchQuery,
  isCreatingSession,
  pendingActions,
  toggleProject,
  setConfirmConfig,
  handleDeleteProject,
  handleCreateSession,
  handleArchiveSession,
  handleDeleteSession,
  handleRenameSession,
  handleForkSession,
  SessionRowComponent = SessionRowPresentation,
  renderQuickLaunch,
}: ProjectItemProps & {
  SessionRowComponent?: ComponentType<SessionRowProps>;
  renderQuickLaunch?: (open: boolean, onClose: () => void) => ReactNode;
}) {
  const [showQuickLaunch, setShowQuickLaunch] = useState(false);
  const [settledExpanded, setSettledExpanded] = useState<boolean | undefined>(undefined);
  const activeSessions = proj.sessions.filter((session) => !session.settledAt);
  const settledSessions = proj.sessions.filter((session) => session.settledAt);
  const showSettled =
    Boolean(searchQuery) ||
    (settledExpanded ?? settledSessions.some((session) => session.id === activeSessionId));
  const showSessions = searchQuery ? true : !isCollapsed;
  const FolderIcon = showSessions ? FolderOpen : Folder;

  const runningSessionsCount = activeSessions.filter((s) => s.status === 'running').length;
  const needsAttentionCount = activeSessions.filter(
    (s) => s.status === 'needs_attention' || s.sidebarActivity === 'input',
  ).length;
  const unreadCount = activeSessions.filter(
    (s) => (s.latestActivityEventId ?? 0) > (s.lastReadEventId ?? 0),
  ).length;
  const errorSessionsCount = activeSessions.filter((s) => s.status === 'error').length;

  const sectionLabel = (label: string) => (
    <div className="text-role-caption text-text-muted flex items-center gap-2 px-2 py-1">
      <span className="icon-compact shrink-0" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );

  const renderSession = (s: SidebarProject['sessions'][number], index: number) => {
    const isPending =
      pendingActions.has(`archive-session-${s.id}`) ||
      pendingActions.has(`delete-session-${s.id}`) ||
      pendingActions.has(`rename-session-${s.id}`) ||
      pendingActions.has(`fork-session-${s.id}`) ||
      pendingActions.has(`pin-session-${s.id}`) ||
      pendingActions.has(`settle-session-${s.id}`);

    const isActive = activeSessionId === s.id;

    return (
      <div key={s.id}>
        {!s.settledAt && index > 0 && !s.pinnedAt && activeSessions[index - 1]?.pinnedAt && (
          <div className="pt-2">{sectionLabel('Active')}</div>
        )}
        <SessionRowComponent
          provider={providersById.get(s.selectedProvider)}
          onPin={handlePinSession}
          onSettle={handleSettleSession}
          session={s}
          isActive={isActive}
          isPending={isPending}
          onRename={handleRenameSession}
          onFork={handleForkSession}
          onArchive={(sessionId, title) => {
            setConfirmConfig({
              isOpen: true,
              title: 'Archive session',
              message: `Archive session "${title}"? This will remove its Git worktree on disk to free up space, but keep its history.`,
              type: 'brand-peach',
              confirmText: 'Archive session',
              onConfirm: () => {
                handleArchiveSession(sessionId, title);
                setConfirmConfig(null);
              },
            });
          }}
          onDelete={(sessionId, title) => {
            setConfirmConfig({
              isOpen: true,
              title: 'Delete session',
              message: `Permanently delete session "${title}" and all its logs? This cannot be undone.`,
              type: 'brand-red',
              confirmText: 'Delete session',
              onConfirm: () => {
                handleDeleteSession(sessionId, title);
                setConfirmConfig(null);
              },
            });
          }}
        />
      </div>
    );
  };

  return (
    <SidebarProjectGroupLayout
      header={
        <SidebarProjectHeaderLayout
          icon={<FolderIcon className="icon-compact text-text-muted shrink-0" />}
          title={proj.name}
          activity={
            <>
              {/* Activity indicators when workspace is collapsed */}
              {isCollapsed && (
                <div className="ml-1 flex shrink-0 items-center gap-2">
                  {runningSessionsCount > 0 && (
                    <Tooltip
                      content={`${runningSessionsCount} session${runningSessionsCount > 1 ? 's' : ''} running`}
                    >
                      <span className="text-text-muted flex items-center justify-center">
                        <Spinner aria-hidden="true" className="icon-compact" />
                      </span>
                    </Tooltip>
                  )}
                  {needsAttentionCount > 0 && (
                    <Tooltip
                      content={`${needsAttentionCount} session${needsAttentionCount > 1 ? 's' : ''} waiting for review`}
                    >
                      <span className="bg-warning h-1.5 w-1.5 shrink-0 rounded-full" />
                    </Tooltip>
                  )}
                  {unreadCount > 0 && (
                    <Tooltip
                      content={`${unreadCount} session${unreadCount > 1 ? 's' : ''} with unread activity`}
                    >
                      <span className="text-role-caption text-text-muted tabular-nums">
                        {unreadCount}
                      </span>
                    </Tooltip>
                  )}
                  {errorSessionsCount > 0 && (
                    <Tooltip
                      content={`${errorSessionsCount} session${errorSessionsCount > 1 ? 's' : ''} with errors`}
                    >
                      <span className="bg-danger h-1.5 w-1.5 shrink-0 rounded-full" />
                    </Tooltip>
                  )}
                </div>
              )}
            </>
          }
          actions={
            <>
              <div className="bg-surface-secondary pointer-events-none absolute inset-y-1 right-2 flex items-center gap-1 rounded-md opacity-0 transition-opacity duration-150 group-focus-within/workspace:pointer-events-auto group-focus-within/workspace:opacity-100 group-hover/workspace:pointer-events-auto group-hover/workspace:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100">
                <div className="flex items-center gap-0.5">
                  <Tooltip content="New session">
                    <IconButton
                      type="button"
                      size="compact"
                      isLoading={isCreatingSession}
                      disabled={isCreatingSession}
                      onClick={(event) => {
                        event.stopPropagation();
                        handleCreateSession(proj.id);
                      }}
                      aria-label="New session"
                    >
                      <Plus className="icon-compact" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip content="Choose agent and model">
                    <IconButton
                      type="button"
                      size="compact"
                      className="motion-disclosure active:transform-none active:opacity-100"
                      disabled={isCreatingSession}
                      onClick={(event) => {
                        event.stopPropagation();
                        setShowQuickLaunch(true);
                      }}
                      aria-label="Quick launch session options"
                    >
                      <ChevronDown className="icon-compact" />
                    </IconButton>
                  </Tooltip>
                </div>

                <Tooltip content="Remove workspace">
                  <IconButton
                    type="button"
                    size="compact"
                    isLoading={pendingActions.has(`delete-project-${proj.id}`)}
                    className="hover:bg-danger/10 hover:text-danger"
                    disabled={pendingActions.has(`delete-project-${proj.id}`)}
                    onClick={(event) => {
                      event.stopPropagation();
                      setConfirmConfig({
                        isOpen: true,
                        title: 'Remove workspace',
                        message: `Are you sure you want to remove workspace "${proj.name}"? This will stop and clean up all its sessions, but will not delete your local files.`,
                        type: 'brand-red',
                        confirmText: 'Remove workspace',
                        onConfirm: () => {
                          handleDeleteProject(proj.id, proj.name);
                          setConfirmConfig(null);
                        },
                      });
                    }}
                    aria-label="Remove workspace"
                  >
                    <Trash2 className="icon-compact" />
                  </IconButton>
                </Tooltip>
              </div>
            </>
          }
          path={proj.path}
          expanded={showSessions}
          onToggle={() => toggleProject(proj.id, isCollapsed)}
        />
      }
    >
      {/* Project Workspace Header Row */}
      {renderQuickLaunch?.(showQuickLaunch, () => setShowQuickLaunch(false))}
      {/* Session groups share the project header gutter. */}
      {showSessions && (
        <div className="min-h-0 min-w-0 space-y-1 py-1">
          {activeSessions.some((s) => s.pinnedAt) && sectionLabel('Pinned')}
          {activeSessions.map(renderSession)}
          {settledSessions.length > 0 && (
            <div className="pt-2">
              <button
                type="button"
                aria-expanded={showSettled}
                aria-controls={`settled-${proj.id}`}
                aria-label={`Settled sessions in ${proj.name}`}
                onClick={() => setSettledExpanded(!showSettled)}
                className="text-role-caption motion-disclosure text-text-muted hover:text-text-main focus-visible:ring-accent/40 hover:bg-surface-secondary/50 flex min-h-7 w-full cursor-pointer items-center gap-2 rounded-lg px-2 text-left focus-visible:ring-2 focus-visible:outline-none"
              >
                <ChevronRight
                  className={`icon-compact shrink-0 ${showSettled ? 'rotate-90' : ''}`}
                  aria-hidden="true"
                />
                <span>Settled</span>
                <span className="ml-auto tabular-nums">{settledSessions.length}</span>
              </button>
              <div id={`settled-${proj.id}`} hidden={!showSettled} className="space-y-1">
                {showSettled && settledSessions.map(renderSession)}
              </div>
            </div>
          )}
        </div>
      )}
    </SidebarProjectGroupLayout>
  );
}

const noop = () => undefined;
const pendingSession: SidebarProject['sessions'][number] = {
  id: 'pending-session',
  title: 'Workspace session',
  taskSlug: '',
  branch: 'workspace/main',
  status: 'idle',
  lastActivityAt: new Date(0),
  updatedAt: new Date(0),
  createdAt: new Date(0),
  mode: 'worktree',
  worktreePath: '',
  hasUserActivity: true,
  selectedProvider: 'pending',
  selectedModel: 'default',
  pinnedAt: null,
  settledAt: null,
  lastReadEventId: 0,
  latestActivityEventId: 0,
  sidebarActivity: 'idle',
};
export function SidebarProjectSkeleton() {
  return (
    <SkeletonSurface message="Loading workspace…">
      <ProjectItemPresentation
        proj={{
          id: 'pending-project',
          name: 'Workspace',
          path: '',
          isGitRepo: true,
          sessions: [pendingSession, { ...pendingSession, id: 'pending-session-2' }],
        }}
        providersById={new Map()}
        handlePinSession={noop}
        handleSettleSession={noop}
        activeSessionId={undefined}
        isCollapsed={false}
        searchQuery=""
        isCreatingSession={false}
        pendingActions={new Set()}
        toggleProject={noop}
        setConfirmConfig={noop}
        handleDeleteProject={noop}
        handleCreateSession={noop}
        handleArchiveSession={noop}
        handleDeleteSession={noop}
        handleRenameSession={noop}
        handleForkSession={noop}
      />
    </SkeletonSurface>
  );
}
