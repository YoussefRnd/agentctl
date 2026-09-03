import { useState, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { RotateCcw, X, ChevronRight, ChevronDown, ExternalLink } from 'lucide-react';
import { useSession, useSessionStream } from '../../../contexts/SessionContext';
import { useSessionActions } from '../../../hooks/useSessionActions';
import { useProviders } from '../../../hooks/useProviders';
import { CommandBar } from './CommandBar';
import { EventFeed } from './EventFeed';
import { SubagentChatView } from './SubagentChatView';
import { extractSubagentGroups } from './cards/subagentBlockUtils';
import { ApprovalCard } from './cards/ApprovalCard';
import { RewindConfirmDialog } from './RewindConfirmDialog';
import { rewindSession, restoreSession, undoRewind } from '@agentctl/api-client';
import { useUIStore, FileIcon } from '@/shared';
import { cn, Tooltip } from '@agentctl/ui';
import { useOpenWorkspaceFile } from '../hooks/useOpenWorkspaceFile';
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

  const handleProviderSelect = (providerId: string, modelId?: string) => {
    switchProvider(providerId, modelId, sessionData);
  };

  const [confirmRewind, setConfirmRewind] = useState<{
    eventId: number;
    mode: RewindMode;
    messageCount?: number;
  } | null>(null);

  const [isRewinding, setIsRewinding] = useState(false);
  const [rewindError, setRewindError] = useState<string | null>(null);
  const isRewindingRef = useRef(false);

  const [rewindUndoState, setRewindUndoState] = useState<{
    eventId: number;
    mode: RewindMode;
    restoredFiles?: Array<{
      path: string;
      status: 'added' | 'modified' | 'deleted';
      additions?: number;
      deletions?: number;
    }>;
  } | null>(null);
  const [isUndoing, setIsUndoing] = useState(false);
  const [isDiffExpanded, setIsDiffExpanded] = useState(false);

  const setWorkbenchTab = useUIStore((s) => s.setWorkbenchTab);
  const setWorkbenchOpen = useUIStore((s) => s.setWorkbenchOpen);
  const setReviewScope = useUIStore((s) => s.setReviewScope);
  const focusReviewFile = useUIStore((s) => s.focusReviewFile);
  const openWorkspaceFile = useOpenWorkspaceFile();

  const totalAdditions = useMemo(
    () => rewindUndoState?.restoredFiles?.reduce((acc, f) => acc + (f.additions ?? 0), 0) ?? 0,
    [rewindUndoState],
  );
  const totalDeletions = useMemo(
    () => rewindUndoState?.restoredFiles?.reduce((acc, f) => acc + (f.deletions ?? 0), 0) ?? 0,
    [rewindUndoState],
  );

  const handleOpenReview = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!rewindUndoState?.restoredFiles) return;
    setWorkbenchTab('changes');
    setWorkbenchOpen(true);
    setReviewScope('all_edits', {
      sessionId,
      files: rewindUndoState.restoredFiles.map((file) => file.path),
    });
  };

  const handleOpenFileReview = (filePath: string) => {
    if (!rewindUndoState?.restoredFiles) return;
    focusReviewFile(filePath, {
      sessionId,
      files: rewindUndoState.restoredFiles.map((file) => file.path),
    });
  };

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
      if (confirmRewind.mode === 'fork') {
        toast.success('Fork created successfully');
      } else {
        toast.success('Session rewound');
        setIsDiffExpanded(false);
        setRewindUndoState({
          eventId: confirmRewind.eventId,
          mode: confirmRewind.mode,
          restoredFiles: result.restoredFiles,
        });
      }
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

  const handleUndoRewind = useCallback(async () => {
    if (!rewindUndoState || isUndoing) return;
    setIsUndoing(true);
    try {
      await undoRewind(sessionId);
      toast.success('Rewind undone');
      setRewindUndoState(null);
      void queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
      void queryClient.invalidateQueries({ queryKey: ['events', sessionId] });
      void queryClient.invalidateQueries({ queryKey: ['session-review', sessionId] });
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to undo rewind');
    } finally {
      setIsUndoing(false);
    }
  }, [rewindUndoState, isUndoing, sessionId, queryClient]);

  const handleEditAndSubmit = useCallback(
    async (eventId: number, newContent: string) => {
      const trimmed = newContent.trim();
      if (!trimmed) return;
      setRewindUndoState(null);
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

  const activeSubagent = useUIStore((s) => s.activeSubagent);
  const activeSubagentId = useUIStore((s) => s.activeSubagentId);
  const setActiveSubagent = useUIStore((s) => s.setActiveSubagent);

  const subagentGroups = useMemo(() => extractSubagentGroups(events), [events]);
  const liveActiveSubagent = useMemo(() => {
    if (activeSubagentId) {
      const found = subagentGroups.find(
        (g: import('./cards/subagentBlockUtils').SubagentGroup) =>
          (g.subagentEvent.data as { subagentId?: string }).subagentId === activeSubagentId,
      );
      if (found) return found;
    }
    return activeSubagent;
  }, [subagentGroups, activeSubagentId, activeSubagent]);

  if (liveActiveSubagent) {
    const isSubagentRunning =
      (liveActiveSubagent.subagentEvent.data as { status?: string }).status === 'running' ||
      (liveActiveSubagent.subagentEvent.data as { status?: string }).status === 'spawning';

    return (
      <SubagentChatView
        group={liveActiveSubagent}
        onBack={() => setActiveSubagent(null)}
        isStreaming={isConnected && isSubagentRunning}
      />
    );
  }

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
            targetEventId={targetEventId}
            onTargetEventHandled={handleTargetEventHandled}
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
        sessionId={sessionId}
        eventId={confirmRewind?.eventId}
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

        {rewindUndoState && (
          <div className="border-border/40 bg-surface-secondary/50 animate-in fade-in slide-in-from-bottom-2 mb-3 overflow-hidden rounded-xl border shadow-xs backdrop-blur-md duration-200">
            <div className="flex items-center justify-between px-3.5 py-2 text-[12px]">
              <div
                onClick={() => {
                  if (rewindUndoState.restoredFiles && rewindUndoState.restoredFiles.length > 0) {
                    setIsDiffExpanded((prev) => !prev);
                  }
                }}
                className={cn(
                  'text-text-muted flex min-w-0 items-center gap-2 pr-2 select-none',
                  rewindUndoState.restoredFiles && rewindUndoState.restoredFiles.length > 0
                    ? 'hover:text-text-main group/undo-header cursor-pointer'
                    : '',
                )}
                role={
                  rewindUndoState.restoredFiles && rewindUndoState.restoredFiles.length > 0
                    ? 'button'
                    : undefined
                }
                tabIndex={
                  rewindUndoState.restoredFiles && rewindUndoState.restoredFiles.length > 0
                    ? 0
                    : undefined
                }
              >
                <RotateCcw className="text-text-muted/70 h-3.5 w-3.5 shrink-0" />
                <span className="text-text-main font-medium">Rewound conversation</span>
                {rewindUndoState.restoredFiles && rewindUndoState.restoredFiles.length > 0 && (
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
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {rewindUndoState.restoredFiles && rewindUndoState.restoredFiles.length > 0 && (
                  <button
                    type="button"
                    onClick={handleOpenReview}
                    className="hover:text-text-main hover:bg-surface-secondary/80 text-text-muted cursor-pointer rounded-md px-2 py-1 text-[12px] font-medium transition-colors"
                    title="Review reverted file changes in Changes tab"
                  >
                    Review
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    void handleUndoRewind();
                  }}
                  disabled={isUndoing}
                  className="hover:text-text-main hover:bg-surface-secondary/80 text-text-muted cursor-pointer rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors"
                >
                  {isUndoing ? 'Undoing...' : 'Undo'}
                </button>
                <button
                  type="button"
                  onClick={() => setRewindUndoState(null)}
                  className="text-text-muted/50 hover:text-text-main hover:bg-surface-secondary/80 cursor-pointer rounded p-1 transition-colors"
                  title="Dismiss"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Expanded diff file list */}
            {isDiffExpanded &&
              rewindUndoState.restoredFiles &&
              rewindUndoState.restoredFiles.length > 0 && (
                <div className="border-border/20 bg-surface-secondary/20 border-t px-2 py-1.5">
                  {rewindUndoState.restoredFiles.map((file) => {
                    const fileName = file.path.split('/').pop() ?? file.path;
                    const dirPath = file.path.includes('/')
                      ? file.path.substring(0, file.path.lastIndexOf('/'))
                      : '';

                    return (
                      <div
                        key={file.path}
                        className="hover:bg-surface/50 group/file-row flex items-center rounded-lg transition-colors"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            handleOpenFileReview(file.path);
                          }}
                          className="flex min-w-0 flex-1 cursor-pointer items-center justify-between px-2.5 py-1.5 text-left"
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-2 text-xs">
                            <FileIcon path={file.path} className="shrink-0" />
                            <span className="text-text-main group-hover/file-row:text-accent truncate font-mono text-[12px] font-medium">
                              {fileName}
                            </span>
                            {dirPath && (
                              <span className="text-text-muted/60 truncate font-mono text-[11px]">
                                {dirPath}
                              </span>
                            )}
                          </div>

                          <div className="ml-3 flex shrink-0 items-center gap-1.5 font-mono text-[11.5px] font-medium">
                            {file.additions != null && file.additions > 0 && (
                              <span className="text-emerald-400">+{file.additions}</span>
                            )}
                            {file.deletions != null && file.deletions > 0 && (
                              <span className="text-rose-400">-{file.deletions}</span>
                            )}
                            {(file.additions == null || file.additions === 0) &&
                              (file.deletions == null || file.deletions === 0) && (
                                <span className="text-text-muted/60 text-[10px]">
                                  {file.status}
                                </span>
                              )}
                          </div>
                        </button>

                        <Tooltip content="Open in editor">
                          <button
                            type="button"
                            onClick={() => {
                              void openWorkspaceFile(file.path);
                            }}
                            className="text-text-muted/40 hover:text-text-main hover:bg-surface-tertiary/60 mr-2 flex h-5.5 w-5.5 cursor-pointer items-center justify-center rounded opacity-0 transition-[opacity,color,background-color] duration-150 group-hover/file-row:opacity-100 focus-visible:opacity-100 active:scale-[0.97]"
                            aria-label={`Open ${fileName} in editor`}
                          >
                            <ExternalLink className="h-3 w-3" />
                          </button>
                        </Tooltip>
                      </div>
                    );
                  })}
                </div>
              )}
          </div>
        )}

        <CommandBar
          onSend={(val, attachmentIds) => {
            setRewindUndoState(null);
            void handleSend(val, attachmentIds);
          }}
          disabled={!isConnected || isSwitching || isLoadingSession}
          selectedProviderId={sessionData?.session.selectedProvider}
          selectedModelId={sessionData?.session.selectedModel}
          onProviderSelect={handleProviderSelect}
          initialInput={rewindInput || initialPrompt}
        />
      </div>
    </div>
  );
}
