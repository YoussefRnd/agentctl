import { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, Pencil, Archive, Trash2, Check, X, GitBranch } from 'lucide-react';
import { ConfirmationModal, Dropdown } from '@agentctl/ui';
import { toast } from 'sonner';
import { useSession, useSessionStream } from '../../../contexts/SessionContext';
import { useSessionActions } from '../../../hooks/useSessionActions';
import { useProviders } from '../../../hooks/useProviders';
import { CommandBar } from './CommandBar';
import { EventFeed } from './EventFeed';
import { ApprovalCard } from './cards/ApprovalCard';
import { RewindConfirmDialog } from './RewindConfirmDialog';
import {
  archiveSession,
  deleteSession,
  renameSession,
  rewindSession,
  restoreSession,
} from '@agentctl/api-client';
import type { ACPEventRow } from '@agentctl/shared';
import type { RewindMode } from './RewindMenu';

export function MainFeed() {
  const { sessionId, sessionData, isLoadingSession } = useSession();
  const { events, isLoadingEvents, isConnected } = useSessionStream();
  const { handleSend, handleApprove, handleDeny } = useSessionActions();
  const { switchProvider, isSwitching } = useProviders(sessionId);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitleValue, setEditTitleValue] = useState('');
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [, setPendingActionKey] = useState<string | null>(null);

  const execute = async <T,>(
    actionKey: string,
    action: () => Promise<T>,
    options?: { successMessage?: string; errorMessage?: string },
  ): Promise<T | null> => {
    setPendingActionKey(actionKey);
    try {
      const result = await action();
      if (options?.successMessage) {
        toast.success(options.successMessage);
      }
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : (options?.errorMessage ?? 'Action failed');
      toast.error(msg);
      return null;
    } finally {
      setPendingActionKey(null);
    }
  };

  const handleRenameSubmit = (e?: React.SyntheticEvent) => {
    if (e) e.preventDefault();
    if (!editTitleValue.trim() || editTitleValue.trim() === sessionData?.session.title) {
      setIsEditingTitle(false);
      return;
    }
    const newTitle = editTitleValue.trim();
    setIsEditingTitle(false);
    void execute(`rename-session-${sessionId}`, () => renameSession(sessionId, newTitle), {
      successMessage: 'Session renamed',
      errorMessage: 'Failed to rename session',
    }).then((result) => {
      if (result) {
        void queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
        void queryClient.invalidateQueries({ queryKey: ['projects'] });
      }
    });
  };

  const handleForkClick = () => {
    const title = sessionData?.session.title ?? 'Untitled session';
    void execute(`fork-session-${sessionId}`, () => rewindSession(sessionId, 999999999, 'fork'), {
      successMessage: `Session "${title}" forked`,
      errorMessage: 'Failed to fork session',
    }).then((result) => {
      if (result?.forkSessionId) {
        void queryClient.invalidateQueries({ queryKey: ['projects'] });
        void navigate(`/sessions/${result.forkSessionId}`);
      }
    });
  };

  const handleArchiveClick = () => {
    void execute(`archive-session-${sessionId}`, () => archiveSession(sessionId), {
      successMessage: 'Session archived',
      errorMessage: 'Failed to archive session',
    }).then((result) => {
      if (result) {
        void queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
        void queryClient.invalidateQueries({ queryKey: ['projects'] });
      }
    });
  };

  const handleDeleteClick = () => {
    setIsDeleteConfirmOpen(true);
  };

  const handleDeleteConfirm = () => {
    setIsDeleteConfirmOpen(false);
    void execute(`delete-session-${sessionId}`, () => deleteSession(sessionId), {
      successMessage: 'Session deleted',
      errorMessage: 'Failed to delete session',
    }).then((result) => {
      if (result) {
        void queryClient.invalidateQueries({ queryKey: ['projects'] });
        void navigate('/');
      }
    });
  };

  const handleProviderSelect = (providerId: string, modelId?: string) => {
    switchProvider(providerId, modelId, sessionData);
  };

  const [confirmRewind, setConfirmRewind] = useState<{
    eventId: number;
    mode: RewindMode;
    messageCount: number;
  } | null>(null);

  const [isRewinding, setIsRewinding] = useState(false);
  const [rewindError, setRewindError] = useState<string | null>(null);
  const isRewindingRef = useRef(false);

  const [rewindInput, setRewindInput] = useState('');

  const handleRewindRequest = useCallback(
    (eventId: number, mode: RewindMode) => {
      const eventIndex = events.findIndex((e) => e.id === eventId);
      if (eventIndex === -1) return;
      const messageCount = mode === 'fork' ? eventIndex + 1 : events.length - eventIndex;

      const event = events[eventIndex];
      const content =
        event.type === 'text' && 'content' in event.data
          ? (event.data as { content: string }).content
          : '';
      setRewindInput(content);

      setConfirmRewind({ eventId, mode, messageCount });
      setRewindError(null);
    },
    [events],
  );

  const handleRewindConfirm = useCallback(async () => {
    if (!confirmRewind) return;
    if (isRewindingRef.current) return;
    isRewindingRef.current = true;
    setIsRewinding(true);
    setRewindError(null);
    try {
      const result = await rewindSession(sessionId, confirmRewind.eventId, confirmRewind.mode);
      toast.success(
        confirmRewind.mode === 'fork' ? 'Fork created successfully' : 'Session rewound',
      );
      setConfirmRewind(null);
      if (result.forkSessionId) {
        void navigate(`/sessions/${result.forkSessionId}`);
      }
      void queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
      void queryClient.invalidateQueries({ queryKey: ['events', sessionId] });
      void queryClient.invalidateQueries({ queryKey: ['session-review', sessionId] });
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
    } catch (err) {
      setRewindError(err instanceof Error ? err.message : 'Rewind failed');
    } finally {
      isRewindingRef.current = false;
      setIsRewinding(false);
    }
  }, [confirmRewind, sessionId, queryClient, navigate]);

  const lastEvent = events[events.length - 1] as ACPEventRow | undefined;

  const approvalEvent =
    lastEvent?.type === 'approval_request' &&
    (lastEvent.data as { status?: string }).status === 'pending'
      ? lastEvent
      : undefined;

  if (!sessionId) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-transparent p-6 text-center">
        <div className="animate-in fade-in zoom-in w-full max-w-md space-y-4 duration-1000">
          <div className="space-y-2.5">
            <div className="text-accent/50 inline-block rounded-full border border-white/5 bg-white/4 px-4 py-1 text-[10px] font-medium">
              Standby
            </div>
            <h1 className="text-text-main text-4xl leading-none font-semibold tracking-tight">
              Select a workspace
            </h1>
            <p className="text-text-muted/50 text-[12px] leading-relaxed">
              Choose a project from the sidebar to start a new agent session.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const status = sessionData?.session.status ?? null;
  const statusConfig = (() => {
    switch (status) {
      case 'running':
        return {
          color: 'bg-brand-blue shadow-[0_0_6px_var(--color-brand-blue)]',
          animate: 'animate-pulse',
        };
      case 'needs_attention':
        return { color: 'bg-brand-peach shadow-[0_0_6px_var(--color-brand-peach)]', animate: '' };
      case 'error':
        return {
          color: 'bg-brand-red shadow-[0_0_6px_var(--color-brand-red)]',
          animate: 'animate-pulse',
        };
      case 'merged':
        return { color: 'bg-brand-mauve/60', animate: '' };
      case 'discarded':
        return { color: 'bg-brand-surface0/40', animate: '' };
      case 'idle':
      default:
        return { color: 'bg-brand-green shadow-[0_0_6px_var(--color-brand-green)]', animate: '' };
    }
  })();

  const sessionDisplayTitle =
    sessionData?.session.title && sessionData.session.title.trim().length > 0
      ? sessionData.session.title
      : 'Untitled session';

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-transparent">
      {/* Session Header */}
      <div className="border-border/20 bg-surface-secondary/10 flex h-12 shrink-0 items-center justify-between border-b px-6 backdrop-blur-md">
        <div className="flex min-w-0 items-center gap-3">
          <div className="relative flex h-2 w-2 shrink-0">
            {statusConfig.animate && (
              <span
                className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${statusConfig.color} ${statusConfig.animate}`}
              />
            )}
            <span className={`relative inline-flex h-2 w-2 rounded-full ${statusConfig.color}`} />
          </div>
          {isEditingTitle ? (
            <form onSubmit={handleRenameSubmit} className="flex min-w-0 items-center gap-1.5">
              <input
                type="text"
                className="bg-surface/50 border-border/40 text-text-main focus:border-accent max-w-[280px] rounded border px-2 py-0.5 text-[12px] font-bold outline-none sm:max-w-[400px]"
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
                  handleRenameSubmit();
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
            <button
              type="button"
              onClick={() => {
                setIsEditingTitle(true);
                setEditTitleValue(sessionData?.session.title ?? '');
              }}
              className="text-text-main hover:text-accent flex min-w-0 cursor-pointer items-center gap-1.5 text-[13px] font-bold tracking-tight transition-colors"
              title="Click to rename session"
            >
              <span className="max-w-[240px] truncate sm:max-w-[380px] md:max-w-[500px]">
                {status === 'error' ? '[crashed] ' : ''}
                {sessionDisplayTitle}
              </span>
              <Pencil className="h-3 w-3 shrink-0 opacity-0 transition-opacity hover:opacity-100" />
            </button>
          )}
        </div>

        {/* More actions dropdown matching sidebar */}
        <Dropdown.Root>
          <Dropdown.Trigger asChild>
            <button
              type="button"
              className="text-text-muted hover:text-text-main hover:bg-surface-secondary/40 cursor-pointer rounded-lg p-1.5 transition-all outline-none"
              aria-label="Session options"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </Dropdown.Trigger>
          <Dropdown.Portal>
            <Dropdown.Content align="end" className="w-40">
              <Dropdown.Item
                className="hover:bg-surface-tertiary text-text-main flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs font-medium transition-colors"
                onSelect={() => {
                  setIsEditingTitle(true);
                  setEditTitleValue(sessionData?.session.title ?? '');
                }}
              >
                <Pencil className="h-3.5 w-3.5 opacity-60" />
                <span>Rename</span>
              </Dropdown.Item>
              <Dropdown.Item
                className="hover:bg-surface-tertiary text-text-main flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs font-medium transition-colors"
                onSelect={() => {
                  handleForkClick();
                }}
              >
                <GitBranch className="h-3.5 w-3.5 opacity-60" />
                <span>Fork session</span>
              </Dropdown.Item>
              {sessionData?.session.status !== 'archived' && (
                <Dropdown.Item
                  className="hover:bg-brand-peach/10 text-brand-peach flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs font-medium transition-colors"
                  onSelect={() => {
                    handleArchiveClick();
                  }}
                >
                  <Archive className="h-3.5 w-3.5 opacity-60" />
                  <span>Archive</span>
                </Dropdown.Item>
              )}
              <Dropdown.Item
                className="hover:bg-brand-red/10 text-brand-red flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs font-medium transition-colors"
                onSelect={() => {
                  handleDeleteClick();
                }}
              >
                <Trash2 className="h-3.5 w-3.5 opacity-65" />
                <span>Delete</span>
              </Dropdown.Item>
            </Dropdown.Content>
          </Dropdown.Portal>
        </Dropdown.Root>
      </div>

      {sessionData?.session.status === 'archived' && (
        <div className="border-warning/30 bg-warning/5 text-warning flex shrink-0 items-center justify-between border-b px-4 py-3 text-xs backdrop-blur-md">
          <span className="tracking-tight">
            This session is archived. Workspace files are cleared from disk.
          </span>
          <button
            type="button"
            onClick={() => {
              void (async () => {
                try {
                  await restoreSession(sessionId);
                  toast.success('Session restored successfully');
                  void queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
                  void queryClient.invalidateQueries({ queryKey: ['events', sessionId] });
                  void queryClient.invalidateQueries({ queryKey: ['session-review', sessionId] });
                  void queryClient.invalidateQueries({ queryKey: ['projects'] });
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Failed to restore session');
                }
              })();
            }}
            className="bg-warning/20 hover:bg-warning/30 border-warning/40 hover:border-warning/60 rounded border px-3 py-1 text-xs font-medium transition-all"
          >
            Restore Session
          </button>
        </div>
      )}

      <main className="min-h-0 w-full flex-1 overflow-hidden">
        {isLoadingEvents ? (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <div className="relative h-8 w-8">
              <div className="absolute inset-0 rounded-full border-2 border-white/5" />
              <div className="border-accent absolute inset-0 animate-spin rounded-full border-2 border-t-transparent" />
            </div>
            <span className="text-text-muted/50 text-[11px] tracking-wide">Loading session...</span>
          </div>
        ) : (
          <EventFeed
            events={events}
            isConnected={isConnected}
            hasGitRepo={sessionData?.session.project?.repoRoot != null}
            isSessionRunning={sessionData?.session.status === 'running'}
            onRewind={handleRewindRequest}
          />
        )}
      </main>

      <ConfirmationModal
        isOpen={isDeleteConfirmOpen}
        title="Delete session"
        message="Permanently delete this session and all its logs? This cannot be undone."
        type="brand-red"
        confirmText="Delete session"
        cancelText="Cancel"
        onConfirm={handleDeleteConfirm}
        onCancel={() => {
          setIsDeleteConfirmOpen(false);
        }}
      />

      <RewindConfirmDialog
        open={confirmRewind !== null}
        onOpenChange={(open: boolean) => {
          if (!open) {
            setConfirmRewind(null);
            setRewindError(null);
          }
        }}
        mode={confirmRewind?.mode ?? 'conversation'}
        messageCount={confirmRewind?.messageCount ?? 0}
        onConfirm={() => {
          void handleRewindConfirm();
        }}
        isLoading={isRewinding}
        error={rewindError}
      />

      <div className="mx-auto w-full max-w-[800px] shrink-0 bg-transparent px-6 pb-4">
        {approvalEvent && (
          <div className="pb-4">
            <div className="animate-in slide-in-from-bottom-4 duration-500">
              <ApprovalCard
                eventId={approvalEvent.id}
                data={approvalEvent.data}
                onApprove={handleApprove}
                onDeny={handleDeny}
              />
            </div>
          </div>
        )}

        <CommandBar
          onSend={(val, attachmentIds) => {
            void handleSend(val, attachmentIds);
          }}
          disabled={!isConnected || isSwitching || isLoadingSession}
          selectedProviderId={sessionData?.session.selectedProvider}
          selectedModelId={sessionData?.session.selectedModel}
          onProviderSelect={handleProviderSelect}
          initialInput={rewindInput}
        />
      </div>
    </div>
  );
}
