import { Link } from 'react-router-dom';
import { Folder, Plus, ChevronRight, ChevronDown, Loader2, Trash2, Archive } from 'lucide-react';
import type { SidebarProject } from '@agentctl/api-client';
import type { SessionStatus } from '@agentctl/shared';
import { Tooltip } from '@agentctl/ui';

const statusColors: Record<SessionStatus, string> = {
  running: 'bg-brand-mauve',
  needs_attention: 'bg-brand-peach',
  idle: 'bg-brand-surface0',
  error: 'bg-brand-red',
  merged: 'bg-brand-green/50',
  discarded: 'bg-brand-surface0/40',
  archived: 'bg-brand-surface0/20',
};

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
}: ProjectItemProps) {
  const showSessions = searchQuery ? true : !isCollapsed;

  return (
    <div className="space-y-0.5">
      <div
        className={`group flex items-center justify-between rounded-lg px-2.5 py-1.5 transition-all duration-150 ${!isCollapsed && proj.sessions.some((s) => s.id === activeSessionId) ? 'bg-surface-secondary/60' : 'hover:bg-surface-secondary/30'} [@media(pointer:coarse)]:px-3 [@media(pointer:coarse)]:py-2.5`}
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
              <ChevronRight className="text-text-muted hover:text-text-main h-3.5 w-3.5 opacity-55 transition-colors" />
            ) : (
              <ChevronDown className="text-text-muted hover:text-text-main h-3.5 w-3.5 opacity-55 transition-colors" />
            )}
          </span>
          <Folder className="text-brand-mauve h-3.5 w-3.5 shrink-0 opacity-80" />
          <span className="text-text-main truncate text-[12px] font-bold tracking-wider uppercase opacity-90 [@media(pointer:coarse)]:text-[13px]">
            {proj.name}
          </span>
        </button>
        <div className="flex items-center gap-1.5 pr-1 opacity-0 transition-opacity group-hover:opacity-100">
          <Tooltip content="Remove">
            <button
              type="button"
              className="hover:text-brand-red text-text-muted/60 hover:bg-brand-red/10 cursor-pointer rounded p-0.5 hover:scale-105 active:scale-95 disabled:opacity-50"
              disabled={pendingActions.has(`delete-project-${proj.id}`)}
              onClick={(event) => {
                event.stopPropagation();
                setConfirmConfig({
                  isOpen: true,
                  title: 'REMOVE PROJECT',
                  message: `Are you sure you want to remove project "${proj.name}"? This will stop and clean up all its sessions, but will not delete your local files.`,
                  type: 'brand-red',
                  confirmText: 'REMOVE_PROJECT',
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

          <Tooltip content="New Session">
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

      {showSessions && (
        <div
          className="grid overflow-hidden transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
          style={{ gridTemplateRows: isCollapsed ? '0fr' : '1fr' }}
        >
          <div className="relative min-h-0 min-w-0 space-y-0.5 pr-2.5 pl-6">
            {/* Vertical nesting line connector */}
            <div className="bg-border/15 absolute top-0 bottom-3 left-[15px] w-[1px]" />

            {proj.sessions.map((s) => (
              <div
                key={s.id}
                className={`group/session hover:bg-surface-secondary/40 relative flex items-center justify-between rounded-lg text-[12px] transition-all ${activeSessionId === s.id ? 'bg-surface-secondary text-brand-mauve font-bold' : 'text-text-muted hover:text-text-main'} min-w-0 [@media(pointer:coarse)]:text-[13px]`}
              >
                <Link
                  to={`/sessions/${s.id}`}
                  className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-2 pl-3"
                >
                  <div className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusColors[s.status]}`} />
                  <span
                    className={`truncate tracking-tight ${s.status === 'archived' ? 'line-through opacity-50' : ''}`}
                  >
                    {s.title || s.taskSlug || s.branch || 'New session'}
                  </span>
                </Link>

                <div className="flex shrink-0 items-center gap-1 pr-2 opacity-0 transition-opacity group-hover/session:opacity-100">
                  {s.status !== 'archived' && (
                    <Tooltip content="Archive">
                      <button
                        type="button"
                        disabled={pendingActions.has(`archive-session-${s.id}`)}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setConfirmConfig({
                            isOpen: true,
                            title: 'ARCHIVE SESSION',
                            message: `Archive session "${s.title || s.taskSlug || 'this session'}"? This will remove its Git worktree on disk to free up space, but keep its history.`,
                            type: 'brand-peach',
                            confirmText: 'ARCHIVE_SESSION',
                            onConfirm: () => {
                              handleArchiveSession(s.id, s.title || s.taskSlug || 'this session');
                              setConfirmConfig(null);
                            },
                          });
                        }}
                        className="hover:text-brand-peach text-text-muted/60 hover:bg-brand-peach/10 cursor-pointer rounded p-0.5 hover:scale-105 active:scale-95 disabled:opacity-50"
                      >
                        {pendingActions.has(`archive-session-${s.id}`) ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Archive className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </Tooltip>
                  )}
                  <Tooltip content="Delete">
                    <button
                      type="button"
                      disabled={pendingActions.has(`delete-session-${s.id}`)}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setConfirmConfig({
                          isOpen: true,
                          title: 'DELETE SESSION',
                          message: `Permanently delete session "${s.title || s.taskSlug || 'this session'}" and all its logs? This cannot be undone.`,
                          type: 'brand-red',
                          confirmText: 'DELETE_SESSION',
                          onConfirm: () => {
                            handleDeleteSession(s.id, s.title || s.taskSlug || 'this session');
                            setConfirmConfig(null);
                          },
                        });
                      }}
                      className="hover:text-brand-red text-text-muted/60 hover:bg-brand-red/10 cursor-pointer rounded p-0.5 hover:scale-105 active:scale-95 disabled:opacity-50"
                    >
                      {pendingActions.has(`delete-session-${s.id}`) ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </Tooltip>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
