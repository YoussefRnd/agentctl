import { useRef, useState, useCallback, useMemo, useEffect, type UIEvent } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Brain, RefreshCw, ArrowDown } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import type { ACPEventRow } from '@agentctl/shared';
import { useSession, useSessionStream } from '../../../contexts/SessionContext';
import { Card } from '@agentctl/ui';
import type { RewindMode } from './RewindMenu';
import { groupFeedEvents } from './eventFeedGrouping';
import { EventFeedItem } from './EventFeedItem';

interface EventFeedProps {
  events: ACPEventRow[];
  isConnected?: boolean;
  hasGitRepo?: boolean;
  isSessionRunning?: boolean;
  onRewind?: (eventId: number, mode: RewindMode) => void;
  onEditSubmit?: (eventId: number, newContent: string) => void;
}

export function EventFeed({
  events,
  isConnected = true,
  hasGitRepo,
  isSessionRunning,
  onRewind,
  onEditSubmit,
}: EventFeedProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const { sessionData, sessionId } = useSession();
  const { streamingEventId } = useSessionStream();
  const isSessionError = sessionData?.session.status === 'error';
  const queryClient = useQueryClient();

  const groupedEvents = useMemo(
    () => groupFeedEvents(events, streamingEventId, isSessionRunning),
    [events, streamingEventId, isSessionRunning],
  );

  const latestAgentGroupId = useMemo(() => {
    if (groupedEvents.length === 0) return null;
    const lastGroup = groupedEvents[groupedEvents.length - 1];
    return lastGroup?.type === 'agent' ? lastGroup.id : null;
  }, [groupedEvents]);

  const virtualizer = useVirtualizer({
    count: groupedEvents.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80,
    overscan: 5,
  });

  const handleScroll = useCallback((e: UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const distanceFromBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
    setAutoScroll(distanceFromBottom < 48);
  }, []);

  // Follow output when new events arrive or while streaming
  useEffect(() => {
    if (autoScroll && groupedEvents.length > 0) {
      virtualizer.scrollToIndex(groupedEvents.length - 1, { align: 'end', behavior: 'auto' });
    }
  }, [groupedEvents.length, streamingEventId, autoScroll, virtualizer]);

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
        className="no-scrollbar h-full w-full flex-grow overflow-y-auto"
      >
        <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const group = groupedEvents[virtualRow.index];
            const groupKey =
              group.type === 'agent' ? group.id : `${group.type}-${String(group.event.id)}`;
            return (
              <div
                key={groupKey}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                className="absolute top-0 left-0 w-full"
                style={{
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <div className="mx-auto max-w-[800px] px-6 py-3">
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
        </div>

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

      {!autoScroll && (
        <button
          type="button"
          className="group border-accent/40 bg-surface-tertiary/95 text-accent hover:border-accent hover:bg-accent hover:text-surface-dark animate-in fade-in-0 zoom-in-95 absolute bottom-6 left-1/2 z-50 flex h-9 w-9 -translate-x-1/2 cursor-pointer items-center justify-center rounded-full border shadow-xl backdrop-blur-xl transition-[background-color,border-color,color,transform] duration-150 ease-out hover:scale-105 active:scale-95"
          title="Scroll to bottom"
          onClick={() => {
            setAutoScroll(true);
            virtualizer.scrollToIndex(groupedEvents.length - 1, {
              align: 'end',
              behavior: 'smooth',
            });
          }}
        >
          <ArrowDown className="h-4 w-4 transition-transform duration-200 group-hover:translate-y-0.5" />
        </button>
      )}
    </div>
  );
}
