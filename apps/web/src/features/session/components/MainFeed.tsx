import { useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ACPEventRow } from '@agentctl/shared';
import { EventFeed } from './EventFeed';
import { CommandBar } from './CommandBar';
import { ApprovalCard } from './cards/ApprovalCard';
import { RewindConfirmDialog } from './RewindConfirmDialog';
import { useSession, useSessionStream } from '../../../contexts/SessionContext';
import { useSessionActions } from '../../../hooks/useSessionActions';
import { useProviders } from '../../../hooks/useProviders';
import { useQueryClient } from '@tanstack/react-query';
import {
  restoreSession,
  rewindSession,
  archiveSession,
  deleteSession,
  renameSession,
} from '@agentctl/api-client';
import { toast } from 'sonner';
import type { RewindMode } from './RewindMenu';
import { MoreHorizontal, Pencil, Archive, Trash2, Check } from 'lucide-react';
import { useActionDispatcher } from '../../../hooks/useActionDispatcher';
import { Dropdown } from '@agentctl/ui';

export function MainFeed() {
  const { sessionId, sessionData, isLoadingSession } = useSession();
  const { events, isLoadingEvents, isConnected } = useSessionStream();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { handleSend, handleApprove, handleDeny } = useSessionActions();
  const { switchProvider, isSwitching } = useProviders(sessionId);

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitleValue, setEditTitleValue] = useState('');
  const { execute } = useActionDispatcher();

  const handleRenameSubmit = (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!editTitleValue.trim()) return;
    void execute(
      `rename-session-${sessionId}`,
      () => renameSession(sessionId, editTitleValue.trim()),
      {
        successMessage: 'Session renamed',
        errorMessage: 'Failed to rename session',
      },
    ).then((result) => {
      if (result) {
        void queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
        void queryClient.invalidateQueries({ queryKey: ['projects'] });
        setIsEditingTitle(false);
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
    if (!window.confirm('Are you sure you want to permanently delete this session?')) return;

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

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-transparent">
      {/* Session Header */}
      <div className="border-border/20 bg-surface-secondary/10 flex h-12 shrink-0 items-center justify-between border-b px-6 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="relative flex h-2 w-2">
            {statusConfig.animate && (
              <span
                className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${statusConfig.color} ${statusConfig.animate}`}
              />
            )}
            <span className={`relative inline-flex h-2 w-2 rounded-full ${statusConfig.color}`} />
          </div>
          {isEditingTitle ? (
            <form onSubmit={handleRenameSubmit} className="flex items-center gap-1.5">
              <input
                type="text"
                className="bg-surface/50 border-border/40 text-text-main focus:border-accent rounded border px-2 py-0.5 text-[12px] font-bold outline-none"
                value={editTitleValue}
                onChange={(e) => {
                  setEditTitleValue(e.target.value);
                }}
                autoFocus
                onBlur={() => {
                  setTimeout(() => {
                    setIsEditingTitle(false);
                  }, 200);
                }}
              />
              <button
                type="submit"
                className="text-accent hover:text-accent/80 p-0.5 transition-colors"
              >
                <Check className="h-3.5 w-3.5" />
              </button>
            </form>
          ) : (
            <span className="text-text-main text-[13px] font-bold tracking-tight">
              {status === 'error' ? '[crashed] ' : ''}
              {sessionData?.session.title ?? `session·${sessionId.slice(0, 8)}`}
            </span>
          )}
        </div>

        {/* More actions dropdown */}
        <Dropdown.Root>
          <Dropdown.Trigger asChild>
            <button
              type="button"
              className="text-text-muted hover:text-text-main hover:bg-surface-secondary/40 rounded-lg p-1.5 transition-all outline-none"
              aria-label="Session options"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </Dropdown.Trigger>
          <Dropdown.Portal>
            <Dropdown.Content align="end" className="w-36">
              <Dropdown.Item
                className="hover:bg-surface-tertiary text-text-main flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs font-medium transition-colors"
                onSelect={() => {
                  setIsEditingTitle(true);
                  setEditTitleValue(sessionData?.session.title ?? '');
                }}
              >
                <Pencil className="h-3.5 w-3.5 opacity-60" />
                Rename
              </Dropdown.Item>
              <Dropdown.Item
                className="hover:bg-surface-tertiary text-text-main flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs font-medium transition-colors"
                onSelect={() => {
                  handleArchiveClick();
                }}
              >
                <Archive className="h-3.5 w-3.5 opacity-60" />
                Archive
              </Dropdown.Item>
              <Dropdown.Item
                className="hover:bg-brand-red/10 text-brand-red flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs font-medium transition-colors"
                onSelect={() => {
                  handleDeleteClick();
                }}
              >
                <Trash2 className="h-3.5 w-3.5 opacity-65" />
                Delete
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

      <RewindConfirmDialog
        open={confirmRewind !== null}
        onOpenChange={(open) => {
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
