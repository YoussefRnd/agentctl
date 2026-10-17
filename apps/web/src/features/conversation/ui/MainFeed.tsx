import { sessionKeys, projectKeys } from '@/shared/lib/queryKeys';
import { useFrameScheduler } from '@/shared/hooks/useFrameScheduler';
import { ChildConversation } from './ChildConversation';
import { ChangedFileRow } from './ChangedFileRow';
import { useRef, useCallback, useMemo, useEffect } from 'react';
import { useConversationHistory } from '../model/useConversationHistory';
import { useConversationHandoff } from '../model/useConversationHandoff';
import { afterPaint, journeyPerformance } from '@/shared/lib/performanceRecorder';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { RotateCcw, X, ChevronRight, ChevronDown } from 'lucide-react';
import {
  RewindConfirmDialog,
  useSession,
  useSessionActions,
  useSessionStream,
  useSessionTurnState,
} from '@/features/sessions';
import { useProviders, SwitchAgentModal } from '@/features/providers';
import { CommandBar } from '@/features/composer';
import { EventFeed } from './EventFeed';
import { NewSessionEmptyState } from './NewSessionEmptyState';
import { ApprovalComposerSlot } from './ApprovalComposerSlot';
import {
  extractSubagentGroups,
  getSubagentGroupKey,
  isSubagentActive,
  useSubagentStore,
} from '@/features/subagents';
import { restoreSession } from '@agentctl/api-client';
import { Button, cn, IconButton, LoadingState } from '@agentctl/ui';

export function MainFeed() {
  const { sessionId, sessionData, isLoadingSession } = useSession();
  const scheduleFrame = useFrameScheduler(sessionId);
  const turn = useSessionTurnState();
  const {
    events,
    visibleEvents,
    isLoadingEvents,
    isConnected,
    historyError,
    loadOlderHistory,
    execution,
    editQueuedMessage,
  } = useSessionStream();
  useEffect(() => {
    if (
      !journeyPerformance.enabled ||
      isLoadingEvents ||
      isLoadingSession ||
      historyError ||
      !sessionData
    )
      return;
    return afterPaint(() => journeyPerformance.finish('session-click-to-feed-painted', sessionId));
  }, [sessionId, isLoadingEvents, isLoadingSession, historyError, sessionData]);
  const { handleSend, handleRetry, handleApprove, handleDeny } = useSessionActions();
  const { switchProvider, isSwitching } = useProviders(sessionId);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();

  const locationState = location.state as {
    initialPrompt?: string;
    targetEventId?: number;
    agent?: string;
  } | null;

  const initialPrompt = locationState?.initialPrompt;
  const targetEventId = locationState?.targetEventId;

  const handleTargetEventHandled = useCallback(() => {
    if (locationState?.targetEventId == null) return;

    void navigate(`${location.pathname}${location.search}${location.hash}`, {
      replace: true,
      state: locationState.initialPrompt
        ? {
            initialPrompt: locationState.initialPrompt,
          }
        : null,
    });
  }, [location.hash, location.pathname, location.search, locationState, navigate]);

  const {
    switchAgentTarget,
    setSwitchAgentTarget,
    isHandoffLoading,
    hasUserMessages,
    handleProviderSelect,
    handleConfirmHandoff,
    handleConfirmNewSession,
  } = useConversationHandoff({ sessionId, sessionData, events, switchProvider });
  const {
    confirmRewind,
    isRewindDialogOpen,
    setIsRewindDialogOpen,
    isRewinding,
    rewindError,
    historyMutationRef,
    historySnapshotRef,
    rewindUndoState,
    setRewindUndoState,
    isUndoing,
    isDiffExpanded,
    setIsDiffExpanded,
    openWorkspaceFile,
    totalAdditions,
    totalDeletions,
    handleOpenReview,
    handleOpenFileReview,
    rewindInput,
    isHistoryChanging,
    handleRewindRequest,
    handleRewindConfirm,
    handleUndoRewind,
    handleEditAndSubmit,
  } = useConversationHistory({ sessionId, events, visibleEvents, handleSend, editQueuedMessage });
  const pendingApprovals = events.filter(
    (event) => event.type === 'approval_request' && event.data.status === 'pending',
  );
  const lastEvent = pendingApprovals.at(-1);
  const approval =
    lastEvent?.type === 'approval_request' &&
    (lastEvent.data as { status?: string }).status === 'pending'
      ? { id: lastEvent.id, data: lastEvent.data }
      : undefined;

  const subagentsConnected =
    isConnected &&
    (execution
      ? execution.connection === 'connected'
      : !['error', 'archived', 'discarded', 'merged'].includes(sessionData?.session.status ?? ''));
  const parentFocusRef = useRef<HTMLElement | null>(null);
  const activeSubagentId = useSubagentStore((s) => s.activeSubagentId);
  const activeSubagentSessionId = useSubagentStore((s) => s.activeSessionId);
  const setActiveSubagentId = useSubagentStore((s) => s.setActiveSubagentId);

  const subagentGroups = useMemo(() => extractSubagentGroups(events), [events]);
  const liveActiveSubagent = useMemo(() => {
    if (activeSubagentId && activeSubagentSessionId === sessionId) {
      const found = subagentGroups.find(
        (g: import('@/features/subagents').SubagentGroup) =>
          getSubagentGroupKey(g) === activeSubagentId,
      );
      if (found) return found;
    }
    return undefined;
  }, [subagentGroups, activeSubagentId, activeSubagentSessionId, sessionId]);

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
    <div className="relative flex h-full w-full overflow-hidden bg-transparent">
      {/* Preserve feed measurements and drafts while the child occupies the chat area. */}
      <div
        data-parent-conversation
        aria-hidden={Boolean(liveActiveSubagent)}
        inert={Boolean(liveActiveSubagent)}
        onFocusCapture={(event) => {
          parentFocusRef.current = event.target;
        }}
        className={cn(
          'min-w-0 flex-1 flex-col overflow-hidden',
          liveActiveSubagent ? 'invisible absolute inset-0 flex' : 'flex',
        )}
      >
        {historyError && events.length === 0 && (
          <div
            role="alert"
            className="text-danger flex items-center justify-between gap-2 px-4 py-3 text-sm"
          >
            <span>Failed to load conversation: {historyError}</span>
            <Button size="sm" disabled={isLoadingEvents} onClick={() => void loadOlderHistory()}>
              Retry
            </Button>
          </div>
        )}
        {sessionData?.session.status === 'archived' && (
          <div className="border-warning/30 bg-warning/5 text-warning flex shrink-0 items-center justify-between border-b px-4 py-2.5 text-xs backdrop-blur-md">
            <span className="tracking-tight">
              This session is archived. Workspace files are cleared from disk.
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void (async () => {
                  try {
                    await restoreSession(sessionId);
                    toast.success('Session restored successfully');
                    void queryClient.invalidateQueries({ queryKey: sessionKeys.detail(sessionId) });
                    void queryClient.invalidateQueries({ queryKey: sessionKeys.events(sessionId) });
                    void queryClient.invalidateQueries({ queryKey: sessionKeys.review(sessionId) });
                    void queryClient.invalidateQueries({ queryKey: projectKeys.all });
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : 'Failed to restore session');
                  }
                })();
              }}
              className="border-warning/40 bg-warning/20 text-warning hover:border-warning/60 hover:bg-warning/30"
            >
              Restore Session
            </Button>
          </div>
        )}

        <RewindConfirmDialog
          open={isRewindDialogOpen}
          onOpenChange={(open: boolean) => {
            if (!open && !historyMutationRef.current) {
              setIsRewindDialogOpen(false);
            }
          }}
          sessionId={sessionId}
          eventId={confirmRewind?.eventId}
          mode={confirmRewind?.mode ?? 'conversation'}
          messageCount={confirmRewind?.messageCount ?? 0}
          onConfirm={() => void handleRewindConfirm()}
          isLoading={isRewinding}
          error={rewindError}
        />
        {!hasUserMessages && !isLoadingEvents && !approval && !isHistoryChanging ? (
          <main
            aria-busy={isHistoryChanging || undefined}
            className="motion-history relative flex min-h-0 w-full flex-1 flex-col items-center justify-center overflow-y-auto select-none"
          >
            <NewSessionEmptyState projectName={sessionData?.session.project?.name ?? 'agentctl'}>
              <CommandBar
                variant="hero"
                onSend={(val, attachmentIds) => {
                  setRewindUndoState(null);
                  void handleSend(val, attachmentIds);
                }}
                disabled={!isConnected || isSwitching || isLoadingSession || isHistoryChanging}
                selectedProviderId={sessionData?.session.selectedProvider}
                selectedModelId={sessionData?.session.selectedModel}
                onProviderSelect={handleProviderSelect}
                initialInput={rewindInput || initialPrompt}
              />
            </NewSessionEmptyState>
          </main>
        ) : (
          <>
            <main
              aria-busy={isHistoryChanging || undefined}
              className="motion-history min-h-0 w-full flex-1 overflow-hidden"
            >
              {isLoadingEvents && !isHistoryChanging ? (
                <LoadingState message="Loading session..." className="h-full" />
              ) : (
                <EventFeed
                  events={
                    isHistoryChanging
                      ? historySnapshotRef.current!.events
                      : (visibleEvents ?? events)
                  }
                  targetEventId={targetEventId}
                  onTargetEventHandled={handleTargetEventHandled}
                  isConnected={isConnected}
                  hasGitRepo={sessionData?.session.project?.repoRoot != null}
                  isSessionRunning={turn !== null || sessionData?.session.status === 'running'}
                  onRewind={handleRewindRequest}
                  onEditSubmit={handleEditAndSubmit}
                  onRetryMessage={handleRetry}
                />
              )}
            </main>

            <div className="mx-auto w-full max-w-[800px] shrink-0 bg-transparent px-3 pb-3 sm:px-6 sm:pb-4">
              {rewindUndoState && !approval && (
                <div className="border-border/40 bg-surface-secondary/50 animate-in fade-in slide-in-from-bottom-2 mb-3 overflow-hidden rounded-xl border shadow-xs backdrop-blur-md duration-200">
                  <div className="flex items-center justify-between px-3.5 py-2 text-[12px]">
                    <button
                      type="button"
                      onClick={() => {
                        if (
                          rewindUndoState.restoredFiles &&
                          rewindUndoState.restoredFiles.length > 0
                        ) {
                          setIsDiffExpanded((prev) => !prev);
                        }
                      }}
                      className={cn(
                        'text-text-muted focus-visible:ring-accent/40 flex min-w-0 items-center gap-2 rounded-md pr-2 text-left outline-none select-none focus-visible:ring-2',
                        rewindUndoState.restoredFiles && rewindUndoState.restoredFiles.length > 0
                          ? 'hover:text-text-main group/undo-header cursor-pointer'
                          : 'cursor-default',
                      )}
                      disabled={
                        !rewindUndoState.restoredFiles || rewindUndoState.restoredFiles.length === 0
                      }
                      aria-expanded={
                        rewindUndoState.restoredFiles && rewindUndoState.restoredFiles.length > 0
                          ? isDiffExpanded
                          : undefined
                      }
                    >
                      <RotateCcw className="text-text-muted/70 h-3.5 w-3.5 shrink-0" />
                      <span className="text-text-main font-medium">Rewound conversation</span>
                      {rewindUndoState.restoredFiles &&
                        rewindUndoState.restoredFiles.length > 0 && (
                          <div className="flex items-center gap-1.5 truncate">
                            <span className="text-text-muted/70 truncate">
                              • Reverted {rewindUndoState.restoredFiles.length}{' '}
                              {rewindUndoState.restoredFiles.length === 1 ? 'file' : 'files'}
                            </span>
                            {(totalAdditions > 0 || totalDeletions > 0) && (
                              <span className="flex items-center gap-1 font-mono text-[11.5px] font-medium">
                                {totalAdditions > 0 && (
                                  <span className="text-emerald-400">+{totalAdditions}</span>
                                )}
                                {totalDeletions > 0 && (
                                  <span className="text-rose-400">-{totalDeletions}</span>
                                )}
                              </span>
                            )}
                            {isDiffExpanded ? (
                              <ChevronDown className="text-text-muted/60 group-hover/undo-header:text-text-main h-3.5 w-3.5 transition-colors" />
                            ) : (
                              <ChevronRight className="text-text-muted/60 group-hover/undo-header:text-text-main h-3.5 w-3.5 transition-colors" />
                            )}
                          </div>
                        )}
                    </button>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {rewindUndoState.restoredFiles &&
                        rewindUndoState.restoredFiles.length > 0 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleOpenReview}
                            className="h-7 px-2.5 text-[12px]"
                            title="Review reverted file changes in Changes tab"
                          >
                            Review
                          </Button>
                        )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          void handleUndoRewind();
                        }}
                        disabled={isUndoing}
                        className="h-7 px-2.5 text-[12px]"
                      >
                        {isUndoing ? 'Undoing...' : 'Undo'}
                      </Button>
                      <IconButton
                        size="sm"
                        onClick={() => setRewindUndoState(null)}
                        className="hover:bg-surface-secondary/80"
                        title="Dismiss"
                        aria-label="Dismiss rewind summary"
                        disabled={isHistoryChanging}
                      >
                        <X className="h-3.5 w-3.5" />
                      </IconButton>
                    </div>
                  </div>

                  {/* Expanded diff file list */}
                  {isDiffExpanded &&
                    rewindUndoState.restoredFiles &&
                    rewindUndoState.restoredFiles.length > 0 && (
                      <div className="border-border/20 bg-surface-secondary/20 border-t px-2 py-1.5">
                        {rewindUndoState.restoredFiles.map((file) => (
                          <ChangedFileRow
                            key={file.path}
                            file={file}
                            onReview={handleOpenFileReview}
                            onOpenEditor={openWorkspaceFile}
                          />
                        ))}
                      </div>
                    )}
                </div>
              )}

              {pendingApprovals.length > 1 && (
                <p className="text-text-muted mb-2 text-xs" role="status">
                  {pendingApprovals.length} requests waiting for approval
                </p>
              )}
              <ApprovalComposerSlot
                approval={approval}
                onApprove={handleApprove}
                onDeny={handleDeny}
              >
                <CommandBar
                  onSend={(val, attachmentIds) => {
                    setRewindUndoState(null);
                    void handleSend(val, attachmentIds);
                  }}
                  disabled={!isConnected || isSwitching || isLoadingSession || isHistoryChanging}
                  selectedProviderId={sessionData?.session.selectedProvider}
                  selectedModelId={sessionData?.session.selectedModel}
                  onProviderSelect={handleProviderSelect}
                  initialInput={rewindInput || initialPrompt}
                />
              </ApprovalComposerSlot>
            </div>
          </>
        )}
      </div>
      {liveActiveSubagent && (
        <ChildConversation
          group={liveActiveSubagent}
          parentTitle={sessionData?.session.title ?? 'Parent conversation'}
          groups={subagentGroups}
          onSelect={(group) => setActiveSubagentId(getSubagentGroupKey(group), sessionId)}
          onBack={() => {
            setActiveSubagentId(null);
            scheduleFrame(() => parentFocusRef.current?.focus());
          }}
          onReviewApproval={() => {
            setActiveSubagentId(null);
            scheduleFrame(() => {
              document
                .querySelector<HTMLElement>(
                  '[data-parent-conversation] [aria-labelledby="approval-title"]',
                )
                ?.focus();
            });
          }}
          isConnected={subagentsConnected}
          isStreaming={
            subagentsConnected &&
            isSubagentActive((liveActiveSubagent.subagentEvent.data as { status: string }).status)
          }
        />
      )}
      {switchAgentTarget && (
        <SwitchAgentModal
          open={Boolean(switchAgentTarget)}
          onOpenChange={(open) => {
            if (!open && !isHandoffLoading) {
              setSwitchAgentTarget(null);
            }
          }}
          currentProvider={sessionData?.session.selectedProvider ?? 'agent'}
          targetProvider={switchAgentTarget.targetProvider}
          targetModel={switchAgentTarget.targetModel}
          onConfirmHandoff={handleConfirmHandoff}
          onConfirmNewSession={handleConfirmNewSession}
          isLoading={isHandoffLoading}
        />
      )}
    </div>
  );
}
