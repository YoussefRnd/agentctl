import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Menu,
  PanelRight,
  Pencil,
  Check,
  X,
  MoreHorizontal,
  GitBranch,
  Archive,
  Trash2,
  FileCode,
} from 'lucide-react';
import { Dropdown, ConfirmationModal, Tooltip } from '@agentctl/ui';
import {
  renameSession,
  archiveSession,
  deleteSession,
  rewindSession,
  apiClient,
  type SidebarProject,
} from '@agentctl/api-client';
import { toast } from 'sonner';
import { useSession } from '../../../contexts/SessionContext';
import { OpenInPicker } from './OpenInPicker';
import type { WorkbenchTab } from './Workbench';

interface SessionHeaderProps {
  onOpenMobileSidebar: () => void;
  onToggleWorkbench: () => void;
  isWorkbenchOpen: boolean;
  onSelectWorkbenchTab?: (tab: WorkbenchTab) => void;
}

export function SessionHeader({
  onOpenMobileSidebar,
  onToggleWorkbench,
  isWorkbenchOpen,
  onSelectWorkbenchTab,
}: SessionHeaderProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { sessionId, sessionData, reviewData } = useSession();

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitleValue, setEditTitleValue] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);

  const { data: projects = [] } = useQuery<SidebarProject[]>({
    queryKey: ['projects'],
    queryFn: () =>
      apiClient.fetch<SidebarProject[]>('/api/projects?sortBy=lastActive&gitOnly=false'),
  });

  const currentProjectId = sessionData?.session.projectId;
  const currentProject = projects.find((p) => p.id === currentProjectId);
  const projectName = currentProject?.name ?? '';
  const worktreePath = sessionData?.session.worktreePath || currentProject?.path || '';

  const rawTitle = sessionData?.session.title ?? '';
  const sessionDisplayTitle = rawTitle.trim().length > 0 ? rawTitle : 'Untitled session';

  const status = sessionData?.session.status ?? 'idle';

  const changesCount = useMemo(
    () => reviewData.files.filter((f) => f.state !== 'committed').length,
    [reviewData],
  );

  const statusConfig = useMemo(() => {
    switch (status) {
      case 'running':
        return {
          color: 'bg-emerald-400',
          animate: true,
          label: 'Running',
        };
      case 'needs_attention':
        return {
          color: 'bg-amber-400',
          animate: false,
          label: 'Needs attention',
        };
      case 'error':
        return {
          color: 'bg-rose-400',
          animate: false,
          label: 'Error',
        };
      default:
        return {
          color: 'bg-text-muted/40',
          animate: false,
          label: 'Idle',
        };
    }
  }, [status]);

  const handleRenameSubmit = async (e?: React.SyntheticEvent) => {
    e?.preventDefault();
    const trimmed = editTitleValue.trim();
    if (!trimmed || trimmed === rawTitle) {
      setIsEditingTitle(false);
      return;
    }
    try {
      await renameSession(sessionId, trimmed);
      void queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      toast.success('Session renamed');
    } catch {
      toast.error('Failed to rename session');
    } finally {
      setIsEditingTitle(false);
    }
  };

  const handleFork = async () => {
    try {
      const res = await rewindSession(sessionId, 999999999, 'fork');
      toast.success('Session forked');
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      if (res.forkSessionId) {
        void navigate(`/sessions/${res.forkSessionId}`);
      }
    } catch {
      toast.error('Failed to fork session');
    }
  };

  const handleArchive = async () => {
    try {
      await archiveSession(sessionId);
      toast.success('Session archived');
      void queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      setIsArchiving(false);
    } catch {
      toast.error('Failed to archive session');
    }
  };

  const handleDelete = async () => {
    try {
      await deleteSession(sessionId);
      toast.success('Session deleted');
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      setIsDeleting(false);
      void navigate('/');
    } catch {
      toast.error('Failed to delete session');
    }
  };

  const handleOpenChanges = () => {
    onSelectWorkbenchTab?.('changes');
    if (!isWorkbenchOpen) {
      onToggleWorkbench();
    }
  };

  return (
    <div className="flex h-full w-full min-w-0 items-center justify-between gap-3">
      {/* Mobile Toggle on Small Screens */}
      <button
        type="button"
        className="text-text-muted hover:text-text-main hover:bg-surface -ml-1 flex h-7 w-7 items-center justify-center rounded-md transition-colors lg:hidden"
        onClick={onOpenMobileSidebar}
        aria-label="Open Sidebar"
      >
        <Menu className="h-4 w-4" />
      </button>

      {/* Center Zone: Prominent Command & Session Bar */}
      <div className="flex min-w-0 flex-1 items-center justify-center px-2">
        <div className="border-border/30 bg-surface/50 hover:border-border/60 hover:bg-surface/80 flex h-7.5 max-w-[440px] min-w-[200px] items-center justify-between gap-2 rounded-lg border px-2.5 transition-all">
          {/* Status Indicator Dot */}
          <div
            className="relative flex h-2 w-2 shrink-0 items-center justify-center"
            title={statusConfig.label}
          >
            {statusConfig.animate && (
              <span
                className={`absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75`}
              />
            )}
            <span
              className={`relative inline-flex h-1.5 w-1.5 rounded-full ${statusConfig.color}`}
            />
          </div>

          {/* Editable Session Title & Project Subtext */}
          {isEditingTitle ? (
            <form
              onSubmit={(e) => {
                void handleRenameSubmit(e);
              }}
              className="flex min-w-0 flex-1 items-center gap-1.5"
            >
              <input
                ref={(el) => {
                  if (el) {
                    el.focus();
                    el.select();
                  }
                }}
                type="text"
                className="bg-surface border-border text-text-main focus:border-accent w-full rounded border px-1.5 py-0.5 text-xs font-medium outline-none"
                value={editTitleValue}
                onChange={(e) => {
                  setEditTitleValue(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setIsEditingTitle(false);
                  }
                }}
                onBlur={() => {
                  void handleRenameSubmit();
                }}
              />
              <button
                type="submit"
                className="text-accent hover:text-accent/80 shrink-0 p-0.5 transition-colors"
                title="Save title"
              >
                <Check className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsEditingTitle(false);
                }}
                className="text-text-muted hover:text-text-main shrink-0 p-0.5 transition-colors"
                title="Cancel"
              >
                <X className="h-3 w-3" />
              </button>
            </form>
          ) : (
            <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
              <div
                onDoubleClick={() => {
                  setIsEditingTitle(true);
                  setEditTitleValue(rawTitle);
                }}
                className="group flex min-w-0 cursor-pointer items-center gap-1.5"
                title="Double click to rename"
              >
                <button
                  type="button"
                  onClick={() => {
                    setIsEditingTitle(true);
                    setEditTitleValue(rawTitle);
                  }}
                  className="text-text-main hover:text-accent flex min-w-0 cursor-pointer items-center gap-1 text-xs font-semibold tracking-tight transition-colors"
                >
                  <span className="truncate">{sessionDisplayTitle}</span>
                  <Pencil className="h-2.5 w-2.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
                </button>
              </div>

              {projectName && (
                <span className="text-text-muted/50 hidden shrink-0 text-xs font-normal sm:inline">
                  · {projectName}
                </span>
              )}
            </div>
          )}

          {/* Session Options Menu */}
          <Dropdown.Root>
            <Dropdown.Trigger asChild>
              <button
                type="button"
                className="text-text-muted hover:text-text-main hover:bg-surface-secondary flex h-5 w-5 cursor-pointer items-center justify-center rounded transition-colors"
                aria-label="Session options"
              >
                <MoreHorizontal className="h-3 w-3" />
              </button>
            </Dropdown.Trigger>
            <Dropdown.Portal>
              <Dropdown.Content align="center" className="w-40">
                <Dropdown.Item
                  className="hover:bg-surface-secondary text-text-main flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs font-medium transition-colors"
                  onSelect={() => {
                    setIsEditingTitle(true);
                    setEditTitleValue(rawTitle);
                  }}
                >
                  <Pencil className="h-3.5 w-3.5 opacity-60" />
                  <span>Rename</span>
                </Dropdown.Item>
                <Dropdown.Item
                  className="hover:bg-surface-secondary text-text-main flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs font-medium transition-colors"
                  onSelect={() => {
                    void handleFork();
                  }}
                >
                  <GitBranch className="h-3.5 w-3.5 opacity-60" />
                  <span>Fork session</span>
                </Dropdown.Item>
                {sessionData?.session.status !== 'archived' && (
                  <Dropdown.Item
                    className="hover:bg-brand-peach/10 text-brand-peach flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs font-medium transition-colors"
                    onSelect={() => {
                      setIsArchiving(true);
                    }}
                  >
                    <Archive className="h-3.5 w-3.5 opacity-60" />
                    <span>Archive</span>
                  </Dropdown.Item>
                )}
                <Dropdown.Item
                  className="hover:bg-brand-red/10 text-brand-red flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs font-medium transition-colors"
                  onSelect={() => {
                    setIsDeleting(true);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5 opacity-60" />
                  <span>Delete</span>
                </Dropdown.Item>
              </Dropdown.Content>
            </Dropdown.Portal>
          </Dropdown.Root>
        </div>
      </div>

      {/* Right Action Suite: Open in IDE + Changes Pill + Inspector Toggle */}
      <div className="flex shrink-0 items-center gap-1.5">
        {/* Open in IDE Split Button */}
        {worktreePath && <OpenInPicker targetPath={worktreePath} />}

        {/* Quick Review / Changes Pill */}
        {changesCount > 0 && (
          <button
            type="button"
            onClick={handleOpenChanges}
            className="border-accent/30 bg-accent/10 text-accent hover:bg-accent/20 flex h-7 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-colors"
            title="View modified files in review"
          >
            <FileCode className="h-3.5 w-3.5" />
            <span>
              {changesCount} {changesCount === 1 ? 'change' : 'changes'}
            </span>
          </button>
        )}

        {/* Inspector / Workbench Toggle */}
        <Tooltip content="Toggle Inspector (⌘\)">
          <button
            type="button"
            onClick={onToggleWorkbench}
            aria-label="Toggle Inspector"
            className={`flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border transition-colors ${
              isWorkbenchOpen
                ? 'border-accent/40 bg-accent/15 text-accent font-bold'
                : 'border-border/30 bg-surface/50 text-text-muted hover:text-text-main hover:border-border/60 hover:bg-surface-secondary'
            }`}
          >
            <PanelRight className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
      </div>

      {/* Archive Modal */}
      {isArchiving && (
        <ConfirmationModal
          isOpen={isArchiving}
          onCancel={() => {
            setIsArchiving(false);
          }}
          onConfirm={() => {
            void handleArchive();
          }}
          title="Archive Session"
          message={`Are you sure you want to archive "${sessionDisplayTitle}"? It will be hidden from the active sidebar.`}
          confirmText="Archive"
          type="brand-peach"
        />
      )}

      {/* Delete Modal */}
      {isDeleting && (
        <ConfirmationModal
          isOpen={isDeleting}
          onCancel={() => {
            setIsDeleting(false);
          }}
          onConfirm={() => {
            void handleDelete();
          }}
          title="Delete Session"
          message={`Are you sure you want to permanently delete "${sessionDisplayTitle}"? This cannot be undone.`}
          confirmText="Delete"
          type="brand-red"
        />
      )}
    </div>
  );
}
