import { sessionKeys } from '@/shared/lib/queryKeys';
import { useCallback, useMemo } from 'react';
import { useFeedViewport } from '../model/useFeedViewport';
import { getGroupKey } from '../lib/feedGroupKey';
import { RefreshCw, ArrowDown, LoaderCircle } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { isComposerOnlyInput, type SessionEventRow } from '@agentctl/shared';
import {
  useSession,
  useSessionStream,
  useSessionTurnIndex,
  type RewindMode,
} from '@/features/sessions';
import { Button, IconButton, LoadingState } from '@agentctl/ui';
import { groupFeedEvents, hasCurrentChatFailure } from '../lib/eventFeedGrouping';
import { useSettingsOverlayStore } from '@/features/settings';
import { TurnErrorCard } from './cards/TurnErrorCard';
import { EventFeedItem } from './EventFeedItem';
import { TurnMinimap } from './TurnMinimap';
import { groupConversationTurns, mergeTurnIndex } from '../lib/turnMinimapGrouping';
import { NewSessionEmptyState } from './NewSessionEmptyState';

interface EventFeedProps {
  events: SessionEventRow[];
  targetEventId?: number;
  onTargetEventHandled?: () => void;
  isConnected?: boolean;
  hasGitRepo?: boolean;
  isSessionRunning?: boolean;
  onRewind?: (eventId: number, mode: RewindMode) => void;
  onEditSubmit?: (eventId: number, newContent: string) => void | boolean | Promise<void | boolean>;
  onRetryMessage?: (eventId: number) => void;
}

export function EventFeed({
  events,
  targetEventId,
  onTargetEventHandled,
  isConnected = true,
  hasGitRepo,
  isSessionRunning,
  onRewind,
  onEditSubmit,
  onRetryMessage,
}: EventFeedProps) {
  const { sessionData, sessionId, reviewData } = useSession();
  const {
    data: turnIndex,
    error: turnIndexError,
    refetch: retryTurnIndex,
  } = useSessionTurnIndex(sessionId);
  const {
    streamingEventId,
    historyRevision,
    hasMoreHistory,
    hasOlderHistory = hasMoreHistory,
    hasNewerHistory = false,
    loadNewerHistory,
    loadEventHistory,
    retryHistory,
    returnToLatestHistory,
    isLoadingNewerHistory,
    loadOlderHistory,
    isLoadingOlderHistory,
    historyError,
    execution,
    queuePendingId,
  } = useSessionStream();
  const isSessionError = sessionData?.session.status === 'error';
  const queryClient = useQueryClient();
  const refreshSession = useCallback(() => {
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: sessionKeys.detail(sessionId) }),
      queryClient.invalidateQueries({ queryKey: sessionKeys.events(sessionId) }),
      queryClient.invalidateQueries({ queryKey: sessionKeys.execution(sessionId) }),
    ]);
  }, [queryClient, sessionId]);
  const openProviderSettings = () => useSettingsOverlayStore.getState().openSettings('providers');

  const activeProvider = useMemo(() => {
    const providerId = sessionData?.session.selectedProvider || sessionData?.session.agent;
    return sessionData?.capabilities?.find((p) => p.id === providerId);
  }, [
    sessionData?.capabilities,
    sessionData?.session.selectedProvider,
    sessionData?.session.agent,
  ]);

  const turnMeta = useMemo(
    () => ({
      modelName: sessionData?.session.selectedModel || sessionData?.session.agent,
      providerName: activeProvider?.label || sessionData?.session.selectedProvider,
      providerIcon:
        activeProvider?.icon ||
        (activeProvider as { agent?: { icon?: string } } | undefined)?.agent?.icon,
      userName: 'You',
    }),
    [
      sessionData?.session.selectedModel,
      sessionData?.session.agent,
      sessionData?.session.selectedProvider,
      activeProvider,
    ],
  );
  const loadedTurns = useMemo(
    () => groupConversationTurns(events, reviewData?.files, turnMeta),
    [events, reviewData?.files, turnMeta],
  );
  const conversationTurns = useMemo(() => {
    if (hasMoreHistory && !turnIndex) return [];
    const composerOnlyIds = new Set(events.filter(isComposerOnlyInput).map((event) => event.id));
    return mergeTurnIndex(
      hasMoreHistory ? (turnIndex ?? []).filter((turn) => !composerOnlyIds.has(turn.eventId)) : [],
      loadedTurns,
      sessionId,
      turnMeta,
    );
  }, [turnIndex, hasMoreHistory, loadedTurns, sessionId, turnMeta, events]);

  const groupedEvents = useMemo(
    () => groupFeedEvents(events, streamingEventId, isSessionRunning),
    [events, streamingEventId, isSessionRunning],
  );
  const {
    parentRef,
    contentRef,
    virtualizer,
    highlightedEventId,
    latestAgentGroupId,
    requestedNavigationRef,
    loadPrevious,
    isFollowingOutput,
    setSelectedTurnEventId,
    setFollowingOutput,
    scrollToBottom,
    activeTurnIndex,
    handleSelectTurn,
    handleScroll,
    handleWheel,
    handleKeyDown,
    handlePointerDown,
    handlePointerEnd,
  } = useFeedViewport({
    groupedEvents,
    conversationTurns,
    sessionId,
    targetEventId,
    onTargetEventHandled,
    isSessionRunning,
    streamingEventId,
    history: {
      historyRevision,
      hasMoreHistory,
      hasOlderHistory,
      hasNewerHistory,
      loadNewerHistory,
      loadEventHistory,
      isLoadingNewerHistory,
      loadOlderHistory,
      isLoadingOlderHistory,
      historyError,
    },
  });
  if ((events.length === 0 || groupedEvents.length === 0) && !isSessionError) {
    if (!isConnected) {
      return <LoadingState message="Connecting to session..." className="h-full py-20" />;
    }

    return <NewSessionEmptyState />;
  }

  return (
    <div
      className="relative flex h-full flex-grow flex-col overflow-hidden"
      role="log"
      aria-live="polite"
      aria-label="Session event feed"
    >
      <div
        ref={parentRef}
        onScroll={handleScroll}
        onWheel={handleWheel}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        tabIndex={0}
        className="no-scrollbar h-full w-full flex-grow overflow-y-auto pr-8 sm:pr-10"
      >
        <div
          ref={contentRef}
          className="relative w-full"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {isLoadingOlderHistory ? (
            <div
              role="status"
              className="text-text-muted absolute inset-x-0 top-0 flex h-10 items-center justify-center gap-2 text-xs"
            >
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              Loading earlier messages…
            </div>
          ) : historyError ? (
            <div
              role="alert"
              className="absolute inset-x-0 top-0 mx-auto flex h-[72px] max-w-[800px] items-center justify-center gap-2 px-3 text-xs"
            >
              <span className="text-text-muted min-w-0" title={historyError}>
                Couldn’t load earlier messages.
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  requestedNavigationRef.current = null;
                  void (retryHistory ? retryHistory() : loadPrevious());
                }}
              >
                Retry
              </Button>
            </div>
          ) : null}
          {virtualizer.getVirtualItems().map((item) => {
            const group = groupedEvents[item.index];
            const groupKey = getGroupKey(group);
            const isGroupHighlighted =
              highlightedEventId != null &&
              (('event' in group && group.event.id === highlightedEventId) ||
                ('events' in group && group.events.some((e) => e.id === highlightedEventId)));

            return (
              <div
                key={groupKey}
                data-index={item.index}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${item.start}px)`,
                }}
                ref={virtualizer.measureElement}
                className="w-full"
              >
                <div
                  className={`mx-auto max-w-[800px] rounded-lg px-3 py-2.5 transition-[background-color,box-shadow] duration-200 sm:px-6 sm:py-3 ${
                    isGroupHighlighted
                      ? 'bg-accent/10 ring-accent shadow-accent/10 shadow-lg ring-2'
                      : ''
                  }`}
                >
                  <EventFeedItem
                    isConnected={isConnected}
                    group={group}
                    latestAgentGroupId={latestAgentGroupId}
                    sessionId={sessionData?.session.id}
                    hasGitRepo={hasGitRepo}
                    onRewind={onRewind}
                    onEditSubmit={onEditSubmit}
                    onRetryMessage={onRetryMessage}
                    onProviderSettings={openProviderSettings}
                    onRefresh={refreshSession}
                    recoveryPending={queuePendingId !== undefined}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {isSessionError && !hasCurrentChatFailure(groupedEvents, execution) && (
          <div className="mx-auto max-w-[800px] px-3 pt-2 pb-4 sm:px-6">
            <TurnErrorCard
              failure={execution?.error}
              message="Agent connection unavailable"
              onRefresh={refreshSession}
              onProviderSettings={openProviderSettings}
              onRetry={
                execution?.eventId !== undefined &&
                onRetryMessage &&
                events.some(
                  (event) =>
                    event.id === execution.eventId &&
                    event.type === 'text' &&
                    event.data.deliveryStatus === 'failed',
                )
                  ? () => onRetryMessage(execution.eventId!)
                  : undefined
              }
              pending={queuePendingId !== undefined}
            />
          </div>
        )}
      </div>

      {!isFollowingOutput && (
        <IconButton
          variant="outline"
          size="default"
          className="border-accent/40 bg-brand-mantle/95 text-accent hover:border-accent hover:bg-accent hover:text-brand-crust animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2 absolute bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full shadow-xl ring-1 ring-white/10 backdrop-blur-xl"
          title="Scroll to bottom"
          aria-label="Scroll to bottom and follow new messages"
          onClick={() => {
            setSelectedTurnEventId(null);
            returnToLatestHistory?.();
            setFollowingOutput(true);
            scrollToBottom(true);
          }}
        >
          <ArrowDown className="h-4 w-4" />
        </IconButton>
      )}

      {conversationTurns.length > 1 && (
        <TurnMinimap
          turns={conversationTurns}
          activeTurnIndex={activeTurnIndex}
          onSelectTurn={handleSelectTurn}
        />
      )}
      {hasMoreHistory && turnIndexError && !turnIndex && (
        <IconButton
          className="absolute top-2 right-2"
          aria-label="Retry conversation timeline"
          title="Couldn’t load the conversation timeline. Retry"
          onClick={() => void retryTurnIndex()}
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </IconButton>
      )}
    </div>
  );
}
