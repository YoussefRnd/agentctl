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
import { restoreSession, rewindSession } from '@agentctl/api-client';
import { toast } from 'sonner';
import type { RewindMode } from './RewindMenu';

export function MainFeed() {
  const { sessionId, sessionData, isLoadingSession } = useSession();
  const { events, isLoadingEvents, isConnected } = useSessionStream();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { handleSend, handleApprove, handleDeny } = useSessionActions();
  const { switchProvider, isSwitching } = useProviders(sessionId);

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

  const handleRewindRequest = useCallback(
    (eventId: number, mode: RewindMode) => {
      const eventIndex = events.findIndex((e) => e.id === eventId);
      if (eventIndex === -1) return;
      const messageCount = mode === 'fork' ? eventIndex + 1 : events.length - eventIndex;
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
      <div className="flex h-full flex-col items-center justify-center bg-transparent p-8 text-center">
        <div className="animate-in fade-in zoom-in w-full max-w-md space-y-8 duration-1000">
          <div className="space-y-4">
            <div className="text-accent/50 inline-block rounded-full border border-white/5 bg-white/4 px-4 py-1 text-[10px] font-medium tracking-widest uppercase">
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
    <div className="relative flex h-full flex-col overflow-hidden bg-transparent">
      <div className="relative z-10 flex h-full min-w-0 flex-col">
        {sessionData?.session.status === 'archived' && (
          <div className="border-warning/30 bg-warning/5 text-warning flex shrink-0 items-center justify-between border-b px-4 py-3 font-mono text-[11px] backdrop-blur-md">
            <span className="tracking-tight uppercase">
              ::WARNING: THIS SESSION IS ARCHIVED. WORKSPACE FILES ARE CLEARED FROM DISK.
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
              className="bg-warning/20 hover:bg-warning/30 border-warning/40 hover:border-warning/60 rounded border px-3 py-1 font-extrabold uppercase transition-all"
            >
              RESTORE_SESSION
            </button>
          </div>
        )}

        <main className="relative flex min-h-0 flex-1 flex-col">
          {isLoadingEvents ? (
            <div className="flex h-full flex-col items-center justify-center gap-3">
              <div className="relative h-8 w-8">
                <div className="absolute inset-0 rounded-full border-2 border-white/5" />
                <div className="border-accent absolute inset-0 animate-spin rounded-full border-2 border-t-transparent" />
              </div>
              <span className="text-text-muted/50 text-[11px] tracking-wide">
                Loading session...
              </span>
            </div>
          ) : (
            <EventFeed
              events={events}
              isConnected={isConnected}
              // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
              hasGitRepo={sessionData?.session?.project?.repoRoot != null}
              // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
              isSessionRunning={sessionData?.session?.status === 'running'}
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

        {/* Floating Footer Overlay */}
        <footer className="pointer-events-none shrink-0">
          {approvalEvent && (
            <div className="pointer-events-auto mx-auto max-w-[800px] px-6 pb-6">
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

          <div className="pointer-events-auto mx-auto w-full max-w-[800px] px-6 pb-6">
            <CommandBar
              onSend={(val, attachmentIds) => {
                void handleSend(val, attachmentIds);
              }}
              disabled={!isConnected || isSwitching || isLoadingSession}
              selectedProviderId={sessionData?.session.selectedProvider}
              selectedModelId={sessionData?.session.selectedModel}
              onProviderSelect={handleProviderSelect}
            />
          </div>
        </footer>
      </div>
    </div>
  );
}
