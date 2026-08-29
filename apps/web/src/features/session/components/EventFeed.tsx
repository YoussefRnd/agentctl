import {
  useRef,
  useState,
  useCallback,
  useMemo,
  useEffect,
  type UIEvent,
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent,
} from 'react';
import { Brain, RefreshCw, ArrowDown } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import type { ACPEventRow } from '@agentctl/shared';
import { useSession, useSessionStream } from '../../../contexts/SessionContext';
import { Card } from '@agentctl/ui';
import type { RewindMode } from './RewindMenu';
import { groupFeedEvents, type FeedEventGroup } from './eventFeedGrouping';
import { EventFeedItem } from './EventFeedItem';
import { TurnMinimap } from './TurnMinimap';
import { groupConversationTurns, type ConversationTurn } from '../lib/turnMinimapGrouping';

interface EventFeedProps {
  events: ACPEventRow[];
  targetEventId?: number;
  onTargetEventHandled?: () => void;
  isConnected?: boolean;
  hasGitRepo?: boolean;
  isSessionRunning?: boolean;
  onRewind?: (eventId: number, mode: RewindMode) => void;
  onEditSubmit?: (eventId: number, newContent: string) => void;
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
}: EventFeedProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [isFollowingOutput, setIsFollowingOutput] = useState(true);
  const isFollowingOutputRef = useRef(true);
  const isPointerScrollingRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  const scrollFrameRef = useRef<number | null>(null);
  const didInitialScrollRef = useRef(false);
  const groupElementsRef = useRef(new Map<string, HTMLDivElement>());
  const [highlightedEventId, setHighlightedEventId] = useState<number | null>(null);
  const [activeTurnIndex, setActiveTurnIndex] = useState<number | null>(null);
  const { sessionData, sessionId, reviewData } = useSession();
  const { streamingEventId } = useSessionStream();
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

      const parentRect = parent.getBoundingClientRect();
      const viewportTop = parentRect.top;

      let closestIdx = 0;
      let minDistance = Infinity;

      for (let i = 0; i < conversationTurns.length; i++) {
        const turn = conversationTurns[i];
        const el = groupElementsRef.current.get(`user-${String(turn.userEvent.id)}`);
        if (el) {
          const rect = el.getBoundingClientRect();
          const dist = Math.abs(rect.top - viewportTop - 40);
          if (rect.top <= viewportTop + parentRect.height && dist < minDistance) {
            minDistance = dist;
            closestIdx = i;
          }
        }
      }

      setActiveTurnIndex(closestIdx);
    });
  }, [conversationTurns]);

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
      const targetElement = groupElementsRef.current.get(`user-${String(turn.userEvent.id)}`);
      if (targetElement) {
        targetElement.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }
    },
    [setFollowingOutput],
  );

  const scrollToBottom = useCallback(() => {
    if (scrollFrameRef.current != null) {
      window.cancelAnimationFrame(scrollFrameRef.current);
    }
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      if (!isFollowingOutputRef.current) return;

      const scrollElement = parentRef.current;
      if (scrollElement) {
        scrollElement.scrollTo({ top: scrollElement.scrollHeight, behavior: 'auto' });
      }
    });
  }, []);

  const handleScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const target = event.currentTarget;
      const isScrollingUp = target.scrollTop < lastScrollTopRef.current - 1;
      lastScrollTopRef.current = target.scrollTop;

      if (isPointerScrollingRef.current && isScrollingUp) {
        setFollowingOutput(false);
      }
      updateActiveTurn();
    },
    [setFollowingOutput, updateActiveTurn],
  );

  const handleWheel = useCallback(
    (event: WheelEvent<HTMLDivElement>) => {
      if (event.deltaY < 0) setFollowingOutput(false);
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

    const targetGroup = groupedEvents.find((group) => {
      if ('event' in group && group.event.id === targetEventId) return true;
      return 'events' in group && group.events.some((event) => event.id === targetEventId);
    });
    if (!targetGroup) return;

    const targetElement = groupElementsRef.current.get(getGroupKey(targetGroup));
    if (!targetElement) return;

    didInitialScrollRef.current = true;
    setFollowingOutput(false);
    setHighlightedEventId(targetEventId);
    targetElement.scrollIntoView({ block: 'center', behavior: 'smooth' });
    onTargetEventHandled?.();
  }, [targetEventId, groupedEvents, onTargetEventHandled, setFollowingOutput]);

  useEffect(() => {
    if (highlightedEventId == null) return;

    const timer = window.setTimeout(() => {
      setHighlightedEventId(null);
    }, 3000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [highlightedEventId]);

  useEffect(() => {
    if (didInitialScrollRef.current || targetEventId != null || groupedEvents.length === 0) {
      return;
    }

    didInitialScrollRef.current = true;
    scrollToBottom();
  }, [groupedEvents.length, scrollToBottom, targetEventId]);

  useEffect(() => {
    if (!isSessionRunning || !isFollowingOutputRef.current || groupedEvents.length === 0) {
      return;
    }

    scrollToBottom();
  }, [groupedEvents.length, isSessionRunning, scrollToBottom, streamingEventId]);

  useEffect(() => {
    if (!hasGroupedEvents) return;

    const contentElement = contentRef.current;
    if (!contentElement) return;

    const observer = new ResizeObserver(() => {
      if (isSessionRunning && isFollowingOutputRef.current) {
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

  if (events.length === 0) {
    if (!isConnected) {
      return (
        <div className="flex h-full items-center justify-center py-20">
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="relative h-8 w-8">
              <div className="absolute inset-0 rounded-full border-2 border-white/5" />
              <div className="border-accent absolute inset-0 animate-spin rounded-full border-2 border-t-transparent" />
            </div>
            <div className="space-y-1">
              <h3 className="text-text-main text-[12px] font-semibold tracking-wide uppercase">
                Connecting...
              </h3>
              <p className="text-text-muted/60 text-[11px] tracking-wide">
                Establishing session uplink
              </p>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="flex h-full items-center justify-center py-20">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="space-y-2">
            <h3 className="text-text-main text-[13px] font-semibold tracking-wide">
              Session ready
            </h3>
            <p className="text-text-muted/60 text-[12px]">Send a message to begin.</p>
          </div>
        </div>
      </div>
    );
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
        <div ref={contentRef} className="w-full">
          {groupedEvents.map((group) => {
            const groupKey = getGroupKey(group);
            const isGroupHighlighted =
              highlightedEventId != null &&
              (('event' in group && group.event.id === highlightedEventId) ||
                ('events' in group && group.events.some((e) => e.id === highlightedEventId)));

            return (
              <div
                key={groupKey}
                ref={(element) => {
                  if (element) {
                    groupElementsRef.current.set(groupKey, element);
                  } else {
                    groupElementsRef.current.delete(groupKey);
                  }
                }}
                className="w-full"
              >
                <div
                  className={`mx-auto max-w-[800px] rounded-2xl px-6 py-3 transition-all duration-500 ${
                    isGroupHighlighted
                      ? 'bg-accent/10 ring-accent shadow-accent/10 shadow-lg ring-2'
                      : ''
                  }`}
                >
                  <EventFeedItem
                    group={group}
                    latestAgentGroupId={latestAgentGroupId}
                    sessionId={sessionData?.session.id}
                    hasGitRepo={hasGitRepo}
                    onRewind={onRewind}
                    onEditSubmit={onEditSubmit}
                  />
                </div>
              </div>
            );
          })}

          {isSessionError && (
            <div className="mx-auto max-w-[800px] px-6 pt-2 pb-4">
              <div className="animate-in fade-in slide-in-from-left-2">
                <Card status="error" className="flex flex-col gap-3 p-5">
                  <div className="flex items-center gap-3">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-rose-500/25 bg-rose-500/8 text-rose-400">
                      <Brain className="h-4 w-4" />
                    </div>
                    <span className="text-[11px] font-bold tracking-wider text-rose-400 uppercase">
                      Agent Connection Interrupted
                    </span>
                  </div>
                  <p className="text-text-muted/90 text-[12px] leading-relaxed">
                    The agent process exited unexpectedly. Type a message in the input below to
                    resuscitate the session, or reconnect the stream.
                  </p>
                  <div className="mt-1 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        void queryClient.invalidateQueries({
                          queryKey: ['session', sessionId],
                        });
                        void queryClient.invalidateQueries({ queryKey: ['events', sessionId] });
                      }}
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/15 px-3 py-1.5 text-[11px] font-bold text-rose-300 transition-colors hover:bg-rose-500/25"
                    >
                      <RefreshCw className="h-3 w-3" />
                      Reconnect Stream
                    </button>
                  </div>
                </Card>
              </div>
            </div>
          )}
        </div>
      </div>

      {!isFollowingOutput && (
        <button
          type="button"
          className="group border-accent/40 bg-surface-tertiary/95 text-accent hover:border-accent hover:bg-accent hover:text-surface-dark animate-in fade-in-0 zoom-in-95 absolute bottom-6 left-1/2 z-50 flex h-9 w-9 -translate-x-1/2 cursor-pointer items-center justify-center rounded-full border shadow-xl backdrop-blur-xl transition-[background-color,border-color,color,transform] duration-150 ease-out hover:scale-105 active:scale-95"
          title="Scroll to bottom"
          aria-label="Scroll to bottom and follow new messages"
          onClick={() => {
            setFollowingOutput(true);
            scrollToBottom();
          }}
        >
          <ArrowDown className="h-4 w-4 transition-transform duration-200 group-hover:translate-y-0.5" />
        </button>
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
