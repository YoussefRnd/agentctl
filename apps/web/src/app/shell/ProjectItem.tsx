import { useState } from 'react';
import type { ProviderDiscovery } from '@agentctl/shared';
import { SessionRow } from './SessionRow';
import { Folder, FolderOpen, Plus, ChevronDown, Loader2, Trash2 } from 'lucide-react';
import type { SidebarProject } from '@agentctl/api-client';
import { IconButton, Tooltip } from '@agentctl/ui';
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

export function ProjectItem({
  proj,
  providersById,
  handlePinSession,
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
}: ProjectItemProps) {
  const [showQuickLaunch, setShowQuickLaunch] = useState(false);
  const showSessions = searchQuery ? true : !isCollapsed;
  const isGit = proj.isGitRepo;
  const FolderIcon = showSessions ? FolderOpen : Folder;

  const runningSessionsCount = proj.sessions.filter((s) => s.status === 'running').length;
  const needsAttentionCount = proj.sessions.filter(
    (s) => s.status === 'needs_attention' || s.sidebarActivity === 'input',
  ).length;
  const unreadCount = proj.sessions.filter(
    (s) => (s.latestActivityEventId ?? 0) > (s.lastReadEventId ?? 0),
  ).length;
  const errorSessionsCount = proj.sessions.filter((s) => s.status === 'error').length;

  return (
    <div className="space-y-1">
      {/* Project Workspace Header Row */}
      <div className="motion-disclosure group/workspace hover:bg-surface-secondary/50 relative flex min-h-9 items-center gap-1 rounded-lg px-2 py-1">
        <button
          type="button"
          aria-expanded={showSessions}
          title={proj.path}
          onClick={() => {
            toggleProject(proj.id, isCollapsed);
          }}
          className="text-role-control motion-disclosure focus-visible:ring-accent/40 flex min-h-7 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md border-none bg-transparent p-0 text-left outline-none focus-visible:ring-2"
        >
          <FolderIcon className="icon-compact text-text-muted shrink-0" />
          <span className="text-text-main truncate font-medium">{proj.name}</span>

          {/* Activity indicators when workspace is collapsed */}
          {isCollapsed && (
            <div className="ml-1 flex shrink-0 items-center gap-2">
              {runningSessionsCount > 0 && (
                <Tooltip
                  content={`${runningSessionsCount} session${runningSessionsCount > 1 ? 's' : ''} running`}
                >
                  <span className="text-text-muted flex items-center justify-center">
                    <Loader2 className="icon-compact animate-spin motion-reduce:animate-none" />
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
        </button>

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
      </div>

      <QuickLaunchSessionDialog
        open={showQuickLaunch}
        onClose={() => {
          setShowQuickLaunch(false);
        }}
        projectId={proj.id}
        projectName={proj.name}
        defaultMode={isGit ? undefined : 'local'}
        allowWorktree={isGit}
      />

      {/* Sessions List with Vertical Hierarchy Guide */}
      {showSessions && (
        <div>
          <div className="border-border/30 ml-3 min-h-0 min-w-0 space-y-1 border-l py-1 pl-2">
            {proj.sessions.some((s) => s.pinnedAt) && (
              <div className="text-role-caption text-text-muted px-6 py-1">Pinned</div>
            )}
            {proj.sessions.map((s, index) => {
              const isPending =
                pendingActions.has(`archive-session-${s.id}`) ||
                pendingActions.has(`delete-session-${s.id}`) ||
                pendingActions.has(`rename-session-${s.id}`) ||
                pendingActions.has(`fork-session-${s.id}`) ||
                pendingActions.has(`pin-session-${s.id}`);

              const isActive = activeSessionId === s.id;

              return (
                <div
                  key={s.id}
                  className={
                    index > 0 && !s.pinnedAt && proj.sessions[index - 1].pinnedAt
                      ? 'border-border/20 mt-1 border-t pt-1'
                      : undefined
                  }
                >
                  <SessionRow
                    provider={providersById.get(s.selectedProvider)}
                    onPin={handlePinSession}
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
            })}
          </div>
        </div>
      )}
    </div>
  );
}
