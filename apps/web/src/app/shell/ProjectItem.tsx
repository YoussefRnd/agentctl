import { useState } from 'react';
import { getSessionDisplayTitle } from '@agentctl/shared';
import { Link } from 'react-router-dom';
import {
  Folder,
  FolderOpen,
  Plus,
  ChevronDown,
  Loader2,
  Trash2,
  Archive,
  MoreHorizontal,
  Pencil,
} from 'lucide-react';
import type { SidebarProject } from '@agentctl/api-client';
import { Dropdown, Tooltip } from '@agentctl/ui';
import { RepoForkedIcon } from '@primer/octicons-react';
import { RelativeTime } from '@/shared';
import { QuickLaunchSessionDialog, prefetchSessionNavigation } from '@/features/sessions';
import { useQueryClient } from '@tanstack/react-query';

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

interface SessionRowProps {
  session: SidebarProject['sessions'][number];
  isActive: boolean;
  isPending: boolean;
  onRename: (id: string, title: string) => void;
  onFork: (id: string, title: string) => void;
  onArchive: (id: string, title: string) => void;
  onDelete: (id: string, title: string) => void;
}

function SessionRow({
  session: s,
  isActive,
  isPending,
  onRename,
  onFork,
  onArchive,
  onDelete,
}: SessionRowProps) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const queryClient = useQueryClient();
  const prefetch = () => {
    if (!isActive) void prefetchSessionNavigation(queryClient, s.id);
  };
  const sessionTitle = getSessionDisplayTitle(s);
  const activityTime = s.lastActivityAt;

  return (
    <div className="group/session relative flex items-center">
      <Link
        to={`/sessions/${s.id}`}
        onMouseEnter={prefetch}
        onFocus={prefetch}
        aria-current={isActive ? 'page' : undefined}
        className={`focus-visible:ring-accent/40 flex min-h-8 w-full min-w-0 items-center justify-between rounded-lg px-2 py-1.5 text-[12px] transition-[background-color,color,box-shadow] duration-150 focus-visible:ring-2 focus-visible:outline-none ${
          isActive
            ? 'bg-accent/10 text-text-main font-medium shadow-xs'
            : 'text-text-muted hover:text-text-main hover:bg-surface-secondary/50'
        }`}
      >
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          {/* Status indicator only when needs attention or error */}
          {s.status === 'needs_attention' && (
            <Tooltip content="Review or approval required">
              <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-amber-400 ring-2 ring-amber-400/20" />
            </Tooltip>
          )}
          {s.status === 'error' && (
            <Tooltip content="Session error">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-rose-400 ring-2 ring-rose-400/20" />
            </Tooltip>
          )}

          <span
            className={`truncate tracking-tight ${
              s.status === 'archived' ? 'line-through opacity-40' : ''
            }`}
          >
            {sessionTitle}
          </span>
        </span>

        {/* Metadata */}
        <span className="flex shrink-0 items-center gap-1">
          {s.status === 'running' ? (
            <Tooltip content="Agent is running...">
              <span
                className={`text-accent flex items-center justify-center ${
                  isDropdownOpen
                    ? 'hidden'
                    : 'group-hover/session:hidden [@media(hover:none)]:hidden'
                }`}
              >
                <Loader2 className="h-3 w-3 animate-spin" />
              </span>
            </Tooltip>
          ) : activityTime ? (
            <RelativeTime
              value={activityTime}
              className={`text-text-muted/40 font-mono text-[10px] tabular-nums ${
                isDropdownOpen ? 'hidden' : 'group-hover/session:hidden [@media(hover:none)]:hidden'
              }`}
            />
          ) : null}
        </span>
      </Link>

      {/* Keep actions above the full-row link without nesting a button inside it. */}
      <div
        className={`pointer-events-none absolute right-1.5 flex opacity-0 transition-opacity duration-150 group-focus-within/session:pointer-events-auto group-focus-within/session:opacity-100 group-hover/session:pointer-events-auto group-hover/session:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100 ${
          isDropdownOpen ? 'pointer-events-auto opacity-100' : ''
        }`}
      >
        <Dropdown.Root open={isDropdownOpen} onOpenChange={setIsDropdownOpen}>
          <Dropdown.Trigger asChild>
            <button
              type="button"
              aria-label="Session options"
              disabled={isPending}
              onClick={(e) => {
                e.stopPropagation();
              }}
              className={`focus-visible:ring-accent/40 click-press flex h-7 w-7 cursor-pointer items-center justify-center rounded-md transition-[color,background-color,transform] duration-150 focus-visible:ring-2 focus-visible:outline-none ${
                isActive || isDropdownOpen
                  ? 'text-text-main hover:bg-surface-secondary'
                  : 'text-text-muted hover:text-text-main hover:bg-surface-secondary'
              } data-[state=open]:bg-surface-secondary disabled:opacity-50 data-[state=open]:flex data-[state=open]:opacity-100`}
            >
              {isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <MoreHorizontal className="h-3.5 w-3.5" />
              )}
            </button>
          </Dropdown.Trigger>
          <Dropdown.Portal>
            <Dropdown.Content align="end" className="w-40">
              <Dropdown.Item
                onSelect={() => {
                  onRename(s.id, sessionTitle);
                }}
                className="gap-2"
              >
                <Pencil className="h-3.5 w-3.5" />
                <span>Rename</span>
              </Dropdown.Item>

              <Dropdown.Item
                onSelect={() => {
                  onFork(s.id, sessionTitle);
                }}
                className="gap-2"
              >
                <RepoForkedIcon className="h-3.5 w-3.5" />
                <span>Fork session</span>
              </Dropdown.Item>

              {s.status !== 'archived' && (
                <Dropdown.Item
                  onSelect={() => {
                    onArchive(s.id, sessionTitle);
                  }}
                  className="text-brand-peach hover:text-brand-peach focus:text-brand-peach gap-2"
                >
                  <Archive className="h-3.5 w-3.5" />
                  <span>Archive</span>
                </Dropdown.Item>
              )}

              <Dropdown.Item
                onSelect={() => {
                  onDelete(s.id, sessionTitle);
                }}
                className="text-brand-red hover:text-brand-red focus:text-brand-red gap-2"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Delete</span>
              </Dropdown.Item>
            </Dropdown.Content>
          </Dropdown.Portal>
        </Dropdown.Root>
      </div>
    </div>
  );
}

export function ProjectItem({
  proj,
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
  const needsAttentionCount = proj.sessions.filter((s) => s.status === 'needs_attention').length;
  const errorSessionsCount = proj.sessions.filter((s) => s.status === 'error').length;

  return (
    <div className="space-y-0.5">
      {/* Project Workspace Header Row */}
      <div className="group/workspace hover:bg-surface-secondary/40 flex min-h-9 items-center justify-between rounded-lg px-2 py-1 transition-colors duration-150">
        <button
          type="button"
          aria-expanded={showSessions}
          onClick={() => {
            toggleProject(proj.id, isCollapsed);
          }}
          className="focus-visible:ring-accent/40 flex min-h-7 min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md border-none bg-transparent p-0 text-left font-normal outline-none focus-visible:ring-2"
        >
          <FolderIcon className="text-accent/80 group-hover/workspace:text-accent h-3.5 w-3.5 shrink-0 transition-colors" />
          <span className="text-text-main/90 group-hover/workspace:text-text-main truncate text-[12.5px] font-semibold tracking-tight">
            {proj.name}
          </span>

          {/* Activity indicators when workspace is collapsed */}
          {isCollapsed && (
            <div className="ml-1.5 flex items-center gap-1">
              {runningSessionsCount > 0 && (
                <Tooltip
                  content={`${runningSessionsCount} session${runningSessionsCount > 1 ? 's' : ''} running`}
                >
                  <span className="text-accent flex items-center justify-center">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  </span>
                </Tooltip>
              )}
              {needsAttentionCount > 0 && (
                <Tooltip
                  content={`${needsAttentionCount} session${needsAttentionCount > 1 ? 's' : ''} waiting for review`}
                >
                  <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-amber-400 ring-2 ring-amber-400/20" />
                </Tooltip>
              )}
              {errorSessionsCount > 0 && (
                <Tooltip
                  content={`${errorSessionsCount} session${errorSessionsCount > 1 ? 's' : ''} with errors`}
                >
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-rose-400 ring-2 ring-rose-400/20" />
                </Tooltip>
              )}
            </div>
          )}
        </button>

        <div className="pointer-events-none flex items-center gap-1 opacity-0 transition-opacity duration-150 group-focus-within/workspace:pointer-events-auto group-focus-within/workspace:opacity-100 group-hover/workspace:pointer-events-auto group-hover/workspace:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100">
          <div className="border-border/30 bg-surface-secondary/40 flex items-center rounded-md border">
            <Tooltip content="New session (Default / Inherited)">
              <button
                type="button"
                className="text-text-muted hover:text-text-main hover:bg-surface-secondary focus-visible:ring-accent/40 click-press flex h-7 w-7 cursor-pointer items-center justify-center rounded-l-md transition-[color,background-color,transform] duration-150 focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
                disabled={isCreatingSession}
                onClick={(event) => {
                  event.stopPropagation();
                  handleCreateSession(proj.id);
                }}
                aria-label="New session"
              >
                {isCreatingSession ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Plus className="h-3.5 w-3.5" />
                )}
              </button>
            </Tooltip>
            <Tooltip content="Quick launch (Customize agent & model)">
              <button
                type="button"
                className="text-text-muted/70 hover:text-accent hover:bg-surface-secondary border-border/20 focus-visible:ring-accent/40 click-press flex h-7 w-5 cursor-pointer items-center justify-center rounded-r-md border-l transition-[color,background-color,transform] duration-150 focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
                disabled={isCreatingSession}
                onClick={(event) => {
                  event.stopPropagation();
                  setShowQuickLaunch(true);
                }}
                aria-label="Quick launch session options"
              >
                <ChevronDown className="h-2.5 w-2.5" />
              </button>
            </Tooltip>
          </div>

          <Tooltip content="Remove workspace">
            <button
              type="button"
              className="text-text-muted/60 hover:text-danger hover:bg-danger/10 focus-visible:ring-danger/40 click-press flex h-7 w-7 cursor-pointer items-center justify-center rounded-md transition-[color,background-color,transform] duration-150 focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
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
              {pendingActions.has(`delete-project-${proj.id}`) ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
            </button>
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
        <div
          className="grid overflow-hidden transition-[grid-template-rows] duration-150 ease-out"
          style={{ gridTemplateRows: showSessions ? '1fr' : '0fr' }}
        >
          <div className="border-border/15 ml-3 min-h-0 min-w-0 space-y-0.5 border-l py-0.5 pr-0.5 pl-2.5">
            {proj.sessions.map((s) => {
              const isPending =
                pendingActions.has(`archive-session-${s.id}`) ||
                pendingActions.has(`delete-session-${s.id}`) ||
                pendingActions.has(`rename-session-${s.id}`) ||
                pendingActions.has(`fork-session-${s.id}`);

              const isActive = activeSessionId === s.id;

              return (
                <SessionRow
                  key={s.id}
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
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
