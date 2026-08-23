import { Link } from 'react-router-dom';
import {
  Folder,
  FolderGit2,
  Plus,
  ChevronRight,
  Loader2,
  Trash2,
  Archive,
  MoreHorizontal,
  Pencil,
  GitBranch,
} from 'lucide-react';
import type { SidebarProject } from '@agentctl/api-client';
import { Dropdown, Tooltip } from '@agentctl/ui';

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
  toggleProject: (projectId: string) => void;
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
  const showSessions = searchQuery ? true : !isCollapsed;
  const isGit = proj.sessions.some((s) => s.mode === 'worktree');
  const FolderIcon = isGit ? FolderGit2 : Folder;

  return (
    <div className="space-y-0.5">
      {/* Project Workspace Header Row */}
      <div className="group hover:bg-surface-secondary/40 flex items-center justify-between rounded-md px-2 py-1 transition-colors duration-150">
        <button
          type="button"
          aria-expanded={!isCollapsed}
          onClick={() => {
            toggleProject(proj.id);
          }}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 border-none bg-transparent p-0 text-left font-normal outline-none"
        >
          <ChevronRight
            className={`text-text-muted/50 group-hover:text-text-main h-3 w-3 shrink-0 transition-transform duration-150 ${
              isCollapsed ? '' : 'rotate-90'
            }`}
          />
          <FolderIcon className="text-text-muted group-hover:text-text-main h-3.5 w-3.5 shrink-0 transition-colors" />
          <span className="text-text-main/90 group-hover:text-text-main truncate text-xs font-semibold tracking-tight">
            {proj.name}
          </span>
        </button>

        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
          <Tooltip content="New session">
            <button
              type="button"
              className="text-text-muted hover:text-text-main hover:bg-surface-secondary flex h-5 w-5 cursor-pointer items-center justify-center rounded transition-colors disabled:opacity-50"
              disabled={isCreatingSession}
              onClick={(event) => {
                event.stopPropagation();
                handleCreateSession(proj.id);
              }}
              aria-label="New session"
            >
              {isCreatingSession ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Plus className="h-3 w-3" />
              )}
            </button>
          </Tooltip>

          <Tooltip content="Remove workspace">
            <button
              type="button"
              className="text-text-muted/60 hover:text-danger hover:bg-danger/10 flex h-5 w-5 cursor-pointer items-center justify-center rounded transition-colors disabled:opacity-50"
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
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Trash2 className="h-3 w-3" />
              )}
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Sessions List */}
      {showSessions && (
        <div
          className="grid overflow-hidden transition-[grid-template-rows] duration-150 ease-out"
          style={{ gridTemplateRows: isCollapsed ? '0fr' : '1fr' }}
        >
          <div className="min-h-0 min-w-0 space-y-0.5 pl-3.5">
            {proj.sessions.map((s) => {
              const sessionTitle = s.title || s.taskSlug || s.branch || 'Untitled session';
              const isPending =
                pendingActions.has(`archive-session-${s.id}`) ||
                pendingActions.has(`delete-session-${s.id}`) ||
                pendingActions.has(`rename-session-${s.id}`) ||
                pendingActions.has(`fork-session-${s.id}`);

              const isActive = activeSessionId === s.id;

              return (
                <div key={s.id} className="group/session relative flex items-center">
                  <div
                    className={`flex w-full min-w-0 items-center justify-between rounded-md px-2 py-1.5 text-xs transition-colors duration-100 ${
                      isActive
                        ? 'bg-surface-secondary text-text-main font-medium'
                        : 'text-text-muted hover:text-text-main hover:bg-surface-secondary/50'
                    }`}
                  >
                    <Link
                      to={`/sessions/${s.id}`}
                      className="flex min-w-0 flex-1 items-center gap-2"
                    >
                      {/* Status indicator dot */}
                      {s.status === 'running' ? (
                        <span className="relative flex h-2 w-2 shrink-0 items-center justify-center">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                        </span>
                      ) : s.status === 'needs_attention' ? (
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                      ) : s.status === 'error' ? (
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-rose-400" />
                      ) : (
                        <span
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                            isActive ? 'bg-accent' : 'bg-text-muted/30'
                          }`}
                        />
                      )}

                      <span
                        className={`truncate tracking-tight ${
                          s.status === 'archived' ? 'line-through opacity-40' : ''
                        }`}
                      >
                        {sessionTitle}
                      </span>
                    </Link>

                    <div className="flex shrink-0 items-center gap-0.5">
                      <Dropdown.Root>
                        <Tooltip content="Session options">
                          <Dropdown.Trigger asChild>
                            <button
                              type="button"
                              aria-label="Session options"
                              disabled={isPending}
                              onClick={(e) => {
                                e.stopPropagation();
                              }}
                              className={`flex h-5 w-5 cursor-pointer items-center justify-center rounded-md transition-colors ${
                                isActive
                                  ? 'text-text-main hover:bg-surface-secondary'
                                  : 'text-text-muted hover:text-text-main hover:bg-surface-secondary'
                              } opacity-0 group-hover/session:opacity-100 focus-visible:opacity-100 disabled:opacity-50 data-[state=open]:opacity-100`}
                            >
                              {isPending ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <MoreHorizontal className="h-3 w-3" />
                              )}
                            </button>
                          </Dropdown.Trigger>
                        </Tooltip>
                        <Dropdown.Portal>
                          <Dropdown.Content align="end" className="w-40">
                            <Dropdown.Item
                              onSelect={() => {
                                handleRenameSession(s.id, sessionTitle);
                              }}
                              className="gap-2"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              <span>Rename</span>
                            </Dropdown.Item>

                            <Dropdown.Item
                              onSelect={() => {
                                handleForkSession(s.id, sessionTitle);
                              }}
                              className="gap-2"
                            >
                              <GitBranch className="h-3.5 w-3.5" />
                              <span>Fork session</span>
                            </Dropdown.Item>

                            {s.status !== 'archived' && (
                              <Dropdown.Item
                                onSelect={() => {
                                  setConfirmConfig({
                                    isOpen: true,
                                    title: 'Archive session',
                                    message: `Archive session "${sessionTitle}"? This will remove its Git worktree on disk to free up space, but keep its history.`,
                                    type: 'brand-peach',
                                    confirmText: 'Archive session',
                                    onConfirm: () => {
                                      handleArchiveSession(s.id, sessionTitle);
                                      setConfirmConfig(null);
                                    },
                                  });
                                }}
                                className="text-brand-peach hover:text-brand-peach focus:text-brand-peach gap-2"
                              >
                                <Archive className="h-3.5 w-3.5" />
                                <span>Archive</span>
                              </Dropdown.Item>
                            )}

                            <Dropdown.Item
                              onSelect={() => {
                                setConfirmConfig({
                                  isOpen: true,
                                  title: 'Delete session',
                                  message: `Permanently delete session "${sessionTitle}" and all its logs? This cannot be undone.`,
                                  type: 'brand-red',
                                  confirmText: 'Delete session',
                                  onConfirm: () => {
                                    handleDeleteSession(s.id, sessionTitle);
                                    setConfirmConfig(null);
                                  },
                                });
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
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
