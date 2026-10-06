import { useVirtualizer } from '@tanstack/react-virtual';
import {
  useRef,
  useState,
  useCallback,
  useMemo,
  useEffect,
  useLayoutEffect,
  type UIEvent,
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent,
} from 'react';
import { RefreshCw, ArrowDown } from 'lucide-react';
import { AgentIcon } from '@/shared';
import { useQueryClient } from '@tanstack/react-query';
import type { SessionEventRow } from '@agentctl/shared';
import { useSession, useSessionStream, type RewindMode } from '@/features/sessions';
import { Button, Card, IconButton, LoadingState } from '@agentctl/ui';
import { groupFeedEvents, type FeedEventGroup } from '../lib/eventFeedGrouping';
import { EventFeedItem } from './EventFeedItem';
import { TurnMinimap } from './TurnMinimap';
import { groupConversationTurns, type ConversationTurn } from '../lib/turnMinimapGrouping';
import { NewSessionEmptyState } from './NewSessionEmptyState';

interface EventFeedProps {
  events: SessionEventRow[];
  targetEventId?: number;
  onTargetEventHandled?: () => void;
  isConnected?: boolean;
  hasGitRepo?: boolean;
  isSessionRunning?: boolean;
  onRewind?: (eventId: number, mode: RewindMode) => void;
  onEditSubmit?: (eventId: number, newContent: string) => void;
  onRetryMessage?: (eventId: number) => void;
}

function getGroupKey(group: FeedEventGroup): string {
  return group.type === 'agent' ? group.id : `${group.type}-${String(group.event.id)}`;
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
  const parentRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [isFollowingOutput, setIsFollowingOutput] = useState(true);
  const isFollowingOutputRef = useRef(true);
  const isPointerScrollingRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  const scrollFrameRef = useRef<number | null>(null);
  const didInitialScrollRef = useRef(false);
  const [highlightedEventId, setHighlightedEventId] = useState<number | null>(null);
  const [activeTurnIndex, setActiveTurnIndex] = useState<number | null>(null);
  const { sessionData, sessionId, reviewData } = useSession();
  const {
    streamingEventId,
    hasMoreHistory,
    loadOlderHistory,
    isLoadingOlderHistory,
    historyError,
  } = useSessionStream();
  const isSessionError = sessionData?.session.status === 'error';
  const queryClient = useQueryClient();

  const activeProvider = useMemo(() => {
    const providerId = sessionData?.session.selectedProvider || sessionData?.session.agent;
    return sessionData?.capabilities?.find((p) => p.id === providerId);
  }, [
    sessionData?.capabilities,
    sessionData?.session.selectedProvider,
    sessionData?.session.agent,
  ]);

  const conversationTurns = useMemo(() => {
    return groupConversationTurns(events, reviewData?.files, {
      modelName: sessionData?.session.selectedModel || sessionData?.session.agent,
      providerName: activeProvider?.label || sessionData?.session.selectedProvider,
      providerIcon:
        activeProvider?.icon ||
        (activeProvider as { agent?: { icon?: string } } | undefined)?.agent?.icon,
      userName: 'You',
    });
  }, [
    events,
    reviewData?.files,
    sessionData?.session.selectedModel,
    sessionData?.session.agent,
    sessionData?.session.selectedProvider,
    activeProvider,
  ]);

  const groupedEvents = useMemo(
    () => groupFeedEvents(events, streamingEventId, isSessionRunning),
    [events, streamingEventId, isSessionRunning],
  );
  const hasGroupedEvents = groupedEvents.length > 0;
  const virtualizer = useVirtualizer({
    count: groupedEvents.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 200,
    getItemKey: (index) => getGroupKey(groupedEvents[index]),
    overscan: 4,
    paddingStart: hasMoreHistory || historyError ? 40 : 0,
  });
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) =>
    !isFollowingOutputRef.current && item.start < (instance.scrollOffset ?? 0);
  const prependAnchorRef = useRef<{ key: string; offset: number; eventId: number } | null>(null);
  const loadPrevious = useCallback(async () => {
    const top = parentRef.current?.scrollTop ?? 0;
    const anchor = virtualizer.getVirtualItems().find((item) => item.end > top);
    if (anchor) {
      const group = groupedEvents[anchor.index];
      prependAnchorRef.current = {
        key: String(anchor.key),
        offset: top - anchor.start,
        eventId: 'event' in group ? group.event.id : (group.events[0]?.id ?? 0),
      };
    }
    setIsFollowingOutput(false);
    isFollowingOutputRef.current = false;
    await loadOlderHistory();
  }, [virtualizer, groupedEvents, loadOlderHistory]);

  useLayoutEffect(() => {
    const anchor = prependAnchorRef.current;
    if (!anchor || isLoadingOlderHistory) return;
    const index = groupedEvents.findIndex(
      (group) =>
        getGroupKey(group) === anchor.key ||
        ('events' in group && group.events.some((event) => event.id === anchor.eventId)),
    );
    if (index !== -1) {
      const offset = virtualizer.getOffsetForIndex(index, 'start')?.[0];
      if (offset !== undefined) virtualizer.scrollToOffset(offset + anchor.offset);
    }
    prependAnchorRef.current = null;
  }, [groupedEvents, isLoadingOlderHistory, virtualizer]);

  const latestAgentGroupId = useMemo(() => {
    if (groupedEvents.length === 0) return null;
    const lastGroup = groupedEvents[groupedEvents.length - 1];
    return lastGroup?.type === 'agent' ? lastGroup.id : null;
  }, [groupedEvents]);

  const setFollowingOutput = useCallback((enabled: boolean) => {
    if (isFollowingOutputRef.current === enabled) return;
    isFollowingOutputRef.current = enabled;
    setIsFollowingOutput(enabled);
  }, []);

  const turnRafRef = useRef<number | null>(null);

  const updateActiveTurn = useCallback(() => {
    if (turnRafRef.current != null) return;

    turnRafRef.current = window.requestAnimationFrame(() => {
      turnRafRef.current = null;
      const parent = parentRef.current;
      if (!parent || conversationTurns.length === 0) return;

      const offset = parent.scrollTop;
      const item = virtualizer.getVirtualItems().find((item) => item.end > offset + 40);
      if (!item) return;
      const input = groupedEvents
        .slice(0, item.index + 1)
        .findLast((group) => group.type === 'user');
      const index = input
        ? conversationTurns.findIndex((turn) => turn.userEvent.id === input.event.id)
        : -1;
      setActiveTurnIndex(index >= 0 ? index : null);
    });
  }, [conversationTurns, groupedEvents, virtualizer]);

  useEffect(() => {
    return () => {
      if (turnRafRef.current != null) {
        window.cancelAnimationFrame(turnRafRef.current);
      }
    };
  }, []);

  const handleSelectTurn = useCallback(
    (turn: ConversationTurn) => {
      setFollowingOutput(false);
      const index = groupedEvents.findIndex(
        (group) => group.type === 'user' && group.event.id === turn.userEvent.id,
      );
      if (index !== -1) virtualizer.scrollToIndex(index, { align: 'start' });
    },
    [setFollowingOutput, groupedEvents, virtualizer],
  );

  // Reset initial scroll state when switching sessions
  useEffect(() => {
    didInitialScrollRef.current = false;
    isFollowingOutputRef.current = true;
    setIsFollowingOutput(true);
  }, [sessionId]);

  const scrollToBottom = useCallback(
    (force = false) => {
      if (scrollFrameRef.current != null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
      scrollFrameRef.current = window.requestAnimationFrame(() => {
        scrollFrameRef.current = null;
        if (!force && !isFollowingOutputRef.current) return;

        const scrollElement = parentRef.current;
        if (scrollElement) {
          virtualizer.scrollToIndex(groupedEvents.length - 1, { align: 'end' });
          const bottom = Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight);
          if (Math.abs(scrollElement.scrollTop - bottom) > 1) {
            scrollElement.scrollTop = bottom;
          }
        }
      });
    },
    [virtualizer, groupedEvents.length],
  );

  const handleScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const target = event.currentTarget;
      const isScrollingUp = target.scrollTop < lastScrollTopRef.current - 1;
      lastScrollTopRef.current = target.scrollTop;

      // Automatically re-enable following and dismiss button when scrolled to bottom
      const isAtBottom = target.scrollTop + target.clientHeight >= target.scrollHeight - 35;

      if (isAtBottom) {
        setFollowingOutput(true);
      } else if (isPointerScrollingRef.current && isScrollingUp) {
        setFollowingOutput(false);
      }
      updateActiveTurn();
    },
    [setFollowingOutput, updateActiveTurn],
  );

  const handleWheel = useCallback(
    (event: WheelEvent<HTMLDivElement>) => {
      const target = event.currentTarget;
      const isAtBottom = target.scrollTop + target.clientHeight >= target.scrollHeight - 35;
      if (isAtBottom && event.deltaY > 0) {
        setFollowingOutput(true);
      } else if (event.deltaY < 0) {
        setFollowingOutput(false);
      }
    },
    [setFollowingOutput],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'ArrowUp' || event.key === 'PageUp' || event.key === 'Home') {
        setFollowingOutput(false);
      }
    },
    [setFollowingOutput],
  );

  const handlePointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.isPrimary) isPointerScrollingRef.current = true;
  }, []);

  const handlePointerEnd = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.isPrimary) isPointerScrollingRef.current = false;
  }, []);

  useEffect(() => {
    if (targetEventId == null || groupedEvents.length === 0) return;

    const targetIndex = groupedEvents.findIndex((group) => {
      if ('event' in group && group.event.id === targetEventId) return true;
      return 'events' in group && group.events.some((event) => event.id === targetEventId);
    });
    if (targetIndex === -1) {
      if (hasMoreHistory && !isLoadingOlderHistory && !historyError) void loadPrevious();
      return;
    }
    didInitialScrollRef.current = true;
    setFollowingOutput(false);
    setHighlightedEventId(targetEventId);
    virtualizer.scrollToIndex(targetIndex, { align: 'center' });
    onTargetEventHandled?.();
  }, [
    targetEventId,
    groupedEvents,
    onTargetEventHandled,
    setFollowingOutput,
    virtualizer,
    hasMoreHistory,
    isLoadingOlderHistory,
    historyError,
    loadPrevious,
  ]);

  useEffect(() => {
    if (highlightedEventId == null) return;

    const timer = window.setTimeout(() => {
      setHighlightedEventId(null);
    }, 3000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [highlightedEventId]);

  // Initial scroll to bottom on load / session switch
  useEffect(() => {
    if (didInitialScrollRef.current || targetEventId != null || groupedEvents.length === 0) {
      return;
    }

    scrollToBottom(true);
    const t1 = setTimeout(() => scrollToBottom(true), 50);
    const t2 = setTimeout(() => scrollToBottom(true), 150);
    const t3 = setTimeout(() => scrollToBottom(true), 300);

    didInitialScrollRef.current = true;
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [groupedEvents.length, scrollToBottom, targetEventId, sessionId]);

  useEffect(() => {
    if (!isFollowingOutputRef.current || groupedEvents.length === 0) {
      return;
    }

    scrollToBottom();
  }, [groupedEvents.length, isSessionRunning, scrollToBottom, streamingEventId]);

  useEffect(() => {
    if (!hasGroupedEvents) return;

    const contentElement = contentRef.current;
    if (!contentElement) return;

    const observer = new ResizeObserver(() => {
      if (isFollowingOutputRef.current || !didInitialScrollRef.current) {
        scrollToBottom();
      }
    });
    observer.observe(contentElement);

    return () => {
      observer.disconnect();
      if (scrollFrameRef.current != null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }
    };
  }, [hasGroupedEvents, isSessionRunning, scrollToBottom]);

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
        {(hasMoreHistory || historyError) && (
          <div className="absolute top-1 left-4 z-10 flex items-center gap-2">
            <Button size="sm" disabled={isLoadingOlderHistory} onClick={() => void loadPrevious()}>
              {isLoadingOlderHistory ? 'Loading…' : 'Load earlier messages'}
            </Button>
            {historyError && (
              <span role="alert" className="text-danger text-xs">
                {historyError}
              </span>
            )}
          </div>
        )}
        <div
          ref={contentRef}
          className="relative w-full"
          style={{ height: virtualizer.getTotalSize() }}
        >
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
                  />
                </div>
              </div>
            );
          })}
        </div>

        {isSessionError && (
          <div className="mx-auto max-w-[800px] px-3 pt-2 pb-4 sm:px-6">
            <div className="animate-in fade-in slide-in-from-left-2">
              <Card status="error" className="flex flex-col gap-3 p-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-rose-500/25 bg-rose-500/8 text-rose-400">
                    <AgentIcon className="h-4 w-4" />
                  </div>
                  <span className="text-[11px] font-bold tracking-wider text-rose-400 uppercase">
                    Agent connection unavailable
                  </span>
                </div>
                <p className="text-text-muted/90 text-[12px] leading-relaxed">
                  The agent connection is unavailable. Refresh the session to see its current state.
                </p>
                <div className="mt-1 flex items-center gap-3">
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => {
                      void queryClient.invalidateQueries({
                        queryKey: ['session', sessionId],
                      });
                      void queryClient.invalidateQueries({ queryKey: ['events', sessionId] });
                    }}
                    className="border border-rose-500/30 bg-rose-500/15 px-3 text-[11px] text-rose-300 hover:bg-rose-500/25"
                  >
                    <RefreshCw className="h-3 w-3" />
                    Refresh session
                  </Button>
                </div>
              </Card>
            </div>
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
    </div>
  );
}
