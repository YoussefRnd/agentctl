import { Link } from 'react-router-dom';
import {
  Folder,
  FolderOpen,
  Plus,
  ChevronRight,
  ChevronDown,
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
  const hasActiveInProject = !isCollapsed && proj.sessions.some((s) => s.id === activeSessionId);

  return (
    <div className="space-y-1">
      {/* Project Folder Row */}
      <div
        className={`group flex items-center justify-between rounded-lg px-2.5 py-1.5 transition-all duration-200 ${
          hasActiveInProject ? 'bg-surface-secondary/70 shadow-xs' : 'hover:bg-surface-secondary/40'
        } [@media(pointer:coarse)]:px-3 [@media(pointer:coarse)]:py-2.5`}
      >
        <button
          type="button"
          aria-expanded={!isCollapsed}
          onClick={() => {
            toggleProject(proj.id);
          }}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 border-none bg-transparent p-0 text-left font-normal outline-none"
        >
          <span className="flex w-3 shrink-0 justify-center">
            {isCollapsed ? (
              <ChevronRight className="text-text-muted group-hover:text-text-main h-3.5 w-3.5 opacity-60 transition-colors" />
            ) : (
              <ChevronDown className="text-accent h-3.5 w-3.5 opacity-90 transition-colors" />
            )}
          </span>
          {isCollapsed ? (
            <Folder className="text-text-muted group-hover:text-brand-mauve h-3.5 w-3.5 shrink-0 transition-colors" />
          ) : (
            <FolderOpen className="text-brand-mauve h-3.5 w-3.5 shrink-0 transition-transform duration-200" />
          )}
          <span className="text-text-main truncate text-[12px] font-bold tracking-tight opacity-90 [@media(pointer:coarse)]:text-[13px]">
            {proj.name}
          </span>
        </button>

        <div className="flex items-center gap-1 pr-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100">
          <Tooltip content="Remove project">
            <button
              type="button"
              className="hover:text-brand-red text-text-muted/60 hover:bg-brand-red/10 cursor-pointer rounded p-0.5 hover:scale-105 active:scale-95 disabled:opacity-50"
              disabled={pendingActions.has(`delete-project-${proj.id}`)}
              onClick={(event) => {
                event.stopPropagation();
                setConfirmConfig({
                  isOpen: true,
                  title: 'Remove project',
                  message: `Are you sure you want to remove project "${proj.name}"? This will stop and clean up all its sessions, but will not delete your local files.`,
                  type: 'brand-red',
                  confirmText: 'Remove project',
                  onConfirm: () => {
                    handleDeleteProject(proj.id, proj.name);
                    setConfirmConfig(null);
                  },
                });
              }}
            >
              {pendingActions.has(`delete-project-${proj.id}`) ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
            </button>
          </Tooltip>

          <Tooltip content="New session">
            <button
              type="button"
              className="hover:text-brand-mauve text-text-muted/60 hover:bg-brand-mauve/10 cursor-pointer rounded p-0.5 hover:scale-105 active:scale-95 disabled:opacity-50"
              disabled={isCreatingSession}
              onClick={(event) => {
                event.stopPropagation();
                handleCreateSession(proj.id);
              }}
            >
              {isCreatingSession ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Nested Sessions Hierarchy */}
      {showSessions && (
        <div
          className="grid overflow-hidden transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
          style={{ gridTemplateRows: isCollapsed ? '0fr' : '1fr' }}
        >
          <div className="relative min-h-0 min-w-0 space-y-1 pr-1 pl-4.5">
            {/* Vertical connector line */}
            <div className="bg-border/25 absolute top-0 bottom-3 left-3 w-[1px]" />

            {proj.sessions.map((s) => {
              const sessionTitle = s.title || s.taskSlug || s.branch || 'Untitled session';
              const isPending =
                pendingActions.has(`archive-session-${s.id}`) ||
                pendingActions.has(`delete-session-${s.id}`) ||
                pendingActions.has(`rename-session-${s.id}`) ||
                pendingActions.has(`fork-session-${s.id}`);

              const isActive = activeSessionId === s.id;

              return (
                <div key={s.id} className="relative flex items-center">
                  {/* Curved branch connector line */}
                  <div className="border-border/25 pointer-events-none absolute top-1/2 left-[-6px] h-3.5 w-3 -translate-y-1/2 rounded-bl-md border-b border-l" />

                  <div
                    className={`group/session relative flex w-full items-center justify-between rounded-lg border py-1 pr-1.5 pl-3 text-[12px] transition-all duration-200 ${
                      isActive
                        ? 'border-accent/40 bg-accent/15 text-accent ring-accent/30 font-semibold shadow-[0_0_16px_rgba(203,166,247,0.22)] ring-1'
                        : 'text-text-muted hover:border-border/30 hover:bg-surface-secondary/50 hover:text-text-main border-transparent'
                    } min-w-0 [@media(pointer:coarse)]:text-[13px]`}
                  >
                    <Link
                      to={`/sessions/${s.id}`}
                      className="flex min-w-0 flex-1 items-center gap-2 py-0.5"
                    >
                      <span
                        className={`truncate tracking-tight ${s.status === 'archived' ? 'line-through opacity-50' : ''}`}
                      >
                        {sessionTitle}
                      </span>
                    </Link>

                    <div className="flex shrink-0 items-center gap-1">
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
                              className={`cursor-pointer rounded p-1 transition-all ${
                                isActive
                                  ? 'text-accent/80 hover:text-accent hover:bg-accent/20'
                                  : 'text-text-muted/60 hover:text-text-main hover:bg-surface-secondary/80'
                              } opacity-70 group-hover/session:opacity-100 focus-visible:opacity-100 disabled:opacity-50 data-[state=open]:opacity-100 [@media(pointer:coarse)]:opacity-100`}
                            >
                              {isPending ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <MoreHorizontal className="h-3.5 w-3.5" />
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
