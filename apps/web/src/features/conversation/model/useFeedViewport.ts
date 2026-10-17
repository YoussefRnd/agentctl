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
import type { useSessionStream } from '@/features/sessions';
import type { FeedEventGroup } from '../lib/eventFeedGrouping';
import type { ConversationTurn } from '../lib/turnMinimapGrouping';
import { getGroupKey } from '../lib/feedGroupKey';

type History = Pick<
  ReturnType<typeof useSessionStream>,
  | 'historyRevision'
  | 'hasMoreHistory'
  | 'hasOlderHistory'
  | 'hasNewerHistory'
  | 'loadNewerHistory'
  | 'loadEventHistory'
  | 'isLoadingNewerHistory'
  | 'loadOlderHistory'
  | 'isLoadingOlderHistory'
  | 'historyError'
>;
/** Owns virtual scroll, historical anchors, follow mode and their timers/observers. */
export function useFeedViewport({
  groupedEvents,
  conversationTurns,
  sessionId,
  targetEventId,
  onTargetEventHandled,
  isSessionRunning,
  streamingEventId,
  history,
}: {
  groupedEvents: FeedEventGroup[];
  conversationTurns: ConversationTurn[];
  sessionId: string;
  targetEventId?: number;
  onTargetEventHandled?: () => void;
  isSessionRunning?: boolean;
  streamingEventId: number | null;
  history: History;
}) {
  const {
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
  } = history;
  const parentRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [isFollowingOutput, setIsFollowingOutput] = useState(true);
  const isFollowingOutputRef = useRef(true);
  const isPointerScrollingRef = useRef(false);
  const userScrollIntentRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  const scrollFrameRef = useRef<number | null>(null);
  const didInitialScrollRef = useRef(false);
  const [highlightedEventId, setHighlightedEventId] = useState<number | null>(null);
  const [activeTurnIndex, setActiveTurnIndex] = useState<number | null>(null);
  const [selectedTurnEventId, setSelectedTurnEventId] = useState<number | null>(null);
  const navigationEventId = targetEventId ?? selectedTurnEventId;
  const hasGroupedEvents = groupedEvents.length > 0;
  const virtualizer = useVirtualizer({
    count: groupedEvents.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 200,
    getItemKey: (index) => getGroupKey(groupedEvents[index]),
    anchorTo: 'end',
    overscan: 4,
    paddingStart: historyError ? 72 : hasMoreHistory ? 40 : 0,
  });
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) =>
    !isFollowingOutputRef.current && item.start < (instance.scrollOffset ?? 0);
  const prependAnchorRef = useRef<{ key: string; offset: number; eventId: number } | null>(null);
  const loadingPreviousRef = useRef(false);
  const loadPrevious = useCallback(async () => {
    if (loadingPreviousRef.current || isLoadingOlderHistory) return;
    loadingPreviousRef.current = true;
    const top = parentRef.current?.scrollTop ?? 0;
    const anchor = virtualizer.getVirtualItemForOffset(top);
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
    try {
      await loadOlderHistory();
    } finally {
      loadingPreviousRef.current = false;
    }
  }, [virtualizer, groupedEvents, loadOlderHistory, isLoadingOlderHistory]);

  const loadPreviousNearTop = useCallback(() => {
    if (
      hasOlderHistory &&
      !historyError &&
      (parentRef.current?.scrollTop ?? Infinity) <= (parentRef.current?.clientHeight ?? 600)
    ) {
      void loadPrevious();
    }
  }, [hasOlderHistory, historyError, loadPrevious]);

  useLayoutEffect(() => {
    const anchor = prependAnchorRef.current;
    if (!anchor || isLoadingOlderHistory) return;
    // The virtualizer preserves stable keys. Only restore explicitly if paging
    // merged the anchored event into a group whose key changed.
    if (groupedEvents.some((group) => getGroupKey(group) === anchor.key)) {
      prependAnchorRef.current = null;
      return;
    }
    const index = groupedEvents.findIndex(
      (group) => 'events' in group && group.events.some((event) => event.id === anchor.eventId),
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
      prependAnchorRef.current = null;
      setSelectedTurnEventId(turn.userEvent.id);
    },
    [setFollowingOutput],
  );

  // Reset initial scroll state when switching sessions
  useEffect(() => {
    didInitialScrollRef.current = false;
    isFollowingOutputRef.current = true;
    setIsFollowingOutput(true);
    setSelectedTurnEventId(null);
    requestedNavigationRef.current = null;
    setActiveTurnIndex(null);
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
      const isAtBottom =
        !hasNewerHistory && target.scrollTop + target.clientHeight >= target.scrollHeight - 35;

      if (isAtBottom) {
        setFollowingOutput(true);
      } else if (isPointerScrollingRef.current && isScrollingUp) {
        setFollowingOutput(false);
      }
      const isUserScroll = isPointerScrollingRef.current || userScrollIntentRef.current;
      if (isScrollingUp && isUserScroll && !isFollowingOutputRef.current) loadPreviousNearTop();
      if (
        isUserScroll &&
        hasNewerHistory &&
        !historyError &&
        !isLoadingNewerHistory &&
        !loadingPreviousRef.current &&
        target.scrollTop + target.clientHeight * 2 >= target.scrollHeight
      )
        void loadNewerHistory?.();
      userScrollIntentRef.current = false;
      updateActiveTurn();
    },
    [
      setFollowingOutput,
      updateActiveTurn,
      loadPreviousNearTop,
      hasNewerHistory,
      historyError,
      isLoadingNewerHistory,
      loadNewerHistory,
    ],
  );

  const handleWheel = useCallback(
    (event: WheelEvent<HTMLDivElement>) => {
      userScrollIntentRef.current = true;
      const target = event.currentTarget;
      const isAtBottom =
        !hasNewerHistory && target.scrollTop + target.clientHeight >= target.scrollHeight - 35;
      if (isAtBottom && event.deltaY > 0) {
        setFollowingOutput(true);
      } else if (event.deltaY < 0) {
        setFollowingOutput(false);
        loadPreviousNearTop();
      }
    },
    [setFollowingOutput, loadPreviousNearTop, hasNewerHistory],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key))
        userScrollIntentRef.current = true;
      if (event.key === 'ArrowUp' || event.key === 'PageUp' || event.key === 'Home') {
        setFollowingOutput(false);
        if (event.target === event.currentTarget) loadPreviousNearTop();
      }
    },
    [setFollowingOutput, loadPreviousNearTop],
  );

  const handlePointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.isPrimary) isPointerScrollingRef.current = true;
  }, []);

  const handlePointerEnd = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.isPrimary) isPointerScrollingRef.current = false;
  }, []);

  const requestedNavigationRef = useRef<number | null>(null);
  useEffect(() => {
    requestedNavigationRef.current = null;
  }, [historyRevision]);
  useEffect(() => {
    if (navigationEventId == null || groupedEvents.length === 0) return;

    const targetIndex = groupedEvents.findIndex((group) => {
      if ('event' in group && group.event.id === navigationEventId) return true;
      return 'events' in group && group.events.some((event) => event.id === navigationEventId);
    });
    if (targetIndex === -1) {
      if (loadEventHistory) {
        if (requestedNavigationRef.current !== navigationEventId) {
          requestedNavigationRef.current = navigationEventId;
          void loadEventHistory(navigationEventId);
        }
      } else if (hasMoreHistory && !isLoadingOlderHistory && !historyError) void loadPrevious();
      return;
    }
    requestedNavigationRef.current = null;
    didInitialScrollRef.current = true;
    setFollowingOutput(false);
    setHighlightedEventId(targetEventId ?? null);
    virtualizer.scrollToIndex(targetIndex, { align: targetEventId != null ? 'center' : 'start' });
    if (targetEventId != null) onTargetEventHandled?.();
    else setSelectedTurnEventId(null);
  }, [
    targetEventId,
    navigationEventId,
    groupedEvents,
    onTargetEventHandled,
    setFollowingOutput,
    virtualizer,
    hasMoreHistory,
    isLoadingOlderHistory,
    historyError,
    loadPrevious,
    loadEventHistory,
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

  return {
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
  };
}
