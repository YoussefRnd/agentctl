import { useState, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useSession, useSessionStream } from '../../../contexts/SessionContext';
import { useSessionActions } from '../../../hooks/useSessionActions';
import { useProviders } from '../../../hooks/useProviders';
import { CommandBar } from './CommandBar';
import { EventFeed } from './EventFeed';
import { ApprovalCard } from './cards/ApprovalCard';
import { RewindConfirmDialog } from './RewindConfirmDialog';
import { rewindSession, restoreSession } from '@agentctl/api-client';
import type { ACPEventRow } from '@agentctl/shared';
import type { RewindMode } from './RewindMenu';

export function MainFeed() {
  const { sessionId, sessionData, isLoadingSession } = useSession();
  const { events, isLoadingEvents, isConnected } = useSessionStream();
  const { handleSend, handleApprove, handleDeny } = useSessionActions();
  const { switchProvider, isSwitching } = useProviders(sessionId);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();

  const locationInitialPrompt = (location.state as { initialPrompt?: string } | null)
    ?.initialPrompt;

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
      const messageCount =
        eventIndex === -1
          ? mode === 'fork'
            ? events.length
            : 1
          : mode === 'fork'
            ? eventIndex + 1
            : events.length - eventIndex;

      const event = eventIndex !== -1 ? events[eventIndex] : null;
      const content =
        event && event.type === 'text' && 'content' in event.data
          ? (event.data as { content: string }).content
          : '';
      if (content) {
        setRewindInput(content);
      }

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

  const handleEditAndSubmit = useCallback(
    async (eventId: number, newContent: string) => {
      const trimmed = newContent.trim();
      if (!trimmed) return;
      try {
        await rewindSession(sessionId, eventId, 'conversation');
        await handleSend(trimmed);
        toast.success('Prompt updated and restarted');
        void queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
        void queryClient.invalidateQueries({ queryKey: ['events', sessionId] });
        void queryClient.invalidateQueries({ queryKey: ['session-review', sessionId] });
        void queryClient.invalidateQueries({ queryKey: ['projects'] });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to update prompt');
      }
    },
    [sessionId, handleSend, queryClient],
  );

  const lastEvent = events[events.length - 1] as ACPEventRow | undefined;

  const approvalEvent =
    lastEvent?.type === 'approval_request' &&
    (lastEvent.data as { status?: string }).status === 'pending'
      ? lastEvent
      : undefined;

  if (!sessionId) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-transparent p-6 text-center">
        <div className="animate-in fade-in zoom-in w-full max-w-md space-y-4">
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

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-transparent">
      {sessionData?.session.status === 'archived' && (
        <div className="border-warning/30 bg-warning/5 text-warning flex shrink-0 items-center justify-between border-b px-4 py-2.5 text-xs backdrop-blur-md">
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
            className="bg-warning/20 hover:bg-warning/30 border-warning/40 hover:border-warning/60 rounded border px-3 py-1 text-xs font-medium transition-colors"
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
            onEditSubmit={handleEditAndSubmit}
          />
        )}
      </main>

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
            <div className="animate-in slide-in-from-bottom-4">
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
          initialInput={rewindInput || locationInitialPrompt}
        />
      </div>
    </div>
  );
}
