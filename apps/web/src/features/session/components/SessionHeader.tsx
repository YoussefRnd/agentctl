import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
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
import { Dropdown, ConfirmationModal } from '@agentctl/ui';
import { renameSession, archiveSession, deleteSession, rewindSession } from '@agentctl/api-client';
import { toast } from 'sonner';
import { useSession } from '../../../contexts/SessionContext';
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
          color: 'bg-brand-green',
          animate: 'animate-ping',
          label: 'Running',
        };
      case 'needs_attention':
        return {
          color: 'bg-brand-peach',
          animate: 'animate-pulse',
          label: 'Needs attention',
        };
      case 'error':
        return {
          color: 'bg-brand-red',
          animate: '',
          label: 'Error',
        };
      default:
        return {
          color: 'bg-text-muted/40',
          animate: '',
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
      {/* Left: Mobile Toggle & Session Context */}
      <div className="flex min-w-0 items-center gap-2.5">
        <button
          type="button"
          className="text-text-muted hover:text-accent hover:bg-accent/10 -ml-1 rounded p-1 transition-all lg:hidden"
          onClick={onOpenMobileSidebar}
          aria-label="Open Sidebar"
        >
          <Menu className="h-4 w-4" />
        </button>

        {/* Status Indicator Dot */}
        <div
          className="relative flex h-2 w-2 shrink-0 items-center justify-center"
          title={statusConfig.label}
        >
          {statusConfig.animate && (
            <span
              className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${statusConfig.color} ${statusConfig.animate}`}
            />
          )}
          <span className={`relative inline-flex h-2 w-2 rounded-full ${statusConfig.color}`} />
        </div>

        {/* Editable Title */}
        {isEditingTitle ? (
          <form
            onSubmit={(e) => {
              void handleRenameSubmit(e);
            }}
            className="flex min-w-0 items-center gap-1.5"
          >
            <input
              type="text"
              className="bg-surface/80 border-border/60 text-text-main focus:border-accent max-w-[240px] rounded border px-2 py-0.5 text-xs font-semibold outline-none sm:max-w-[360px]"
              value={editTitleValue}
              onChange={(e) => {
                setEditTitleValue(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setIsEditingTitle(false);
                }
              }}
              autoFocus
              onBlur={() => {
                void handleRenameSubmit();
              }}
            />
            <button
              type="submit"
              className="text-accent hover:text-accent/80 shrink-0 p-0.5 transition-colors"
              title="Save title"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                setIsEditingTitle(false);
              }}
              className="text-text-muted hover:text-text-main shrink-0 p-0.5 transition-colors"
              title="Cancel"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </form>
        ) : (
          <div className="group flex min-w-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setIsEditingTitle(true);
                setEditTitleValue(rawTitle);
              }}
              className="text-text-main hover:text-accent flex min-w-0 cursor-pointer items-center gap-1 text-xs font-semibold tracking-tight transition-colors"
              title="Click to rename"
            >
              <span className="max-w-[200px] truncate sm:max-w-[320px] md:max-w-[420px]">
                {status === 'error' ? '[crashed] ' : ''}
                {sessionDisplayTitle}
              </span>
              <Pencil className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
            </button>

            {/* Session Action Menu */}
            <Dropdown.Root>
              <Dropdown.Trigger asChild>
                <button
                  type="button"
                  className="text-text-muted hover:text-text-main hover:bg-surface-secondary/40 cursor-pointer rounded p-1 transition-all outline-none"
                  aria-label="Session options"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </button>
              </Dropdown.Trigger>
              <Dropdown.Portal>
                <Dropdown.Content align="start" className="w-40">
                  <Dropdown.Item
                    className="hover:bg-surface-tertiary text-text-main flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs font-medium transition-colors"
                    onSelect={() => {
                      setIsEditingTitle(true);
                      setEditTitleValue(rawTitle);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5 opacity-60" />
                    <span>Rename</span>
                  </Dropdown.Item>
                  <Dropdown.Item
                    className="hover:bg-surface-tertiary text-text-main flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs font-medium transition-colors"
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
        )}
      </div>

      {/* Right: Quick Review Pill & Inspector Toggle */}
      <div className="flex shrink-0 items-center gap-2">
        {changesCount > 0 && (
          <button
            type="button"
            onClick={handleOpenChanges}
            className="border-accent/30 bg-accent/10 text-accent hover:bg-accent/20 flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-all"
            title="View modified files in review"
          >
            <FileCode className="h-3.5 w-3.5" />
            <span>Changes ({changesCount})</span>
          </button>
        )}

        {/* Workbench Toggle */}
        <button
          type="button"
          onClick={onToggleWorkbench}
          aria-label="Toggle Inspector"
          title="Toggle Inspector (⌘\)"
          className={`flex h-7 w-7 items-center justify-center rounded-lg border transition-all duration-200 ${
            isWorkbenchOpen
              ? 'border-accent/40 bg-accent/15 text-accent font-bold'
              : 'border-border/30 bg-surface/40 text-text-muted hover:text-text-main hover:border-border/60 hover:bg-surface/70'
          }`}
        >
          <PanelRight className="h-3.5 w-3.5" />
        </button>
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
