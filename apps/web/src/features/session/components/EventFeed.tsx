import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { Brain } from 'lucide-react';
import { TextCard } from './cards/TextCard';
import { ToolCallCard } from './cards/ToolCallCard';
import { ActivityGroup } from './cards/ActivityGroup';
import type { ACPEventRow } from '@agentctl/shared';
import { useSession } from '../../../contexts/SessionContext';

export function EventFeed({ events }: { events: ACPEventRow[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const { streamingEventId } = useSession();

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [events, autoScroll]);

  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 100);
  }, []);

  const groupedEvents = useMemo(() => {
    const result: (
      | { type: 'event'; event: ACPEventRow; isStreaming: boolean }
      | { type: 'activity'; events: ACPEventRow[]; isStreaming: boolean; id: string }
    )[] = [];
    let currentActivity: {
      type: 'activity';
      events: ACPEventRow[];
      isStreaming: boolean;
      id: string;
    } | null = null;

    for (const e of events) {
      const isThought = e.type === 'text' && 'role' in e.data && e.data.role === 'thought';
      const isTool = e.type === 'tool_call';
      const isStreaming = e.id === streamingEventId;

      if (isThought || isTool) {
        if (!currentActivity) {
          currentActivity = {
            type: 'activity',
            events: [e],
            isStreaming,
            id: `activity-${String(e.id)}`,
          };
          result.push(currentActivity);
        } else {
          currentActivity.events.push(e);
          if (isStreaming) currentActivity.isStreaming = true;
        }
      } else {
        currentActivity = null;
        result.push({ type: 'event', event: e, isStreaming });
      }
    }
    return result;
  }, [events, streamingEventId]);

  // Robustly identify the last content event (text or tool_call)
  const lastContentEvent = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.type === 'text' || e.type === 'tool_call') return e;
    }
    return null;
  }, [events]);

  const isAwaitingAgent = useMemo(() => {
    if (!lastContentEvent) return false;
    return (
      lastContentEvent.type === 'text' &&
      'role' in lastContentEvent.data &&
      lastContentEvent.data.role === 'user'
    );
  }, [lastContentEvent]);

  if (events.length === 0) {
    return (
      <div className="flex h-full items-center justify-center py-20">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="relative h-12 w-12">
            <div className="absolute inset-0 rounded-full border-2 border-white/5" />
            <div className="border-accent absolute inset-0 animate-spin rounded-full border-2 border-t-transparent" />
          </div>
          <div className="space-y-1">
            <h3 className="text-text-main text-[12px] font-black tracking-[0.2em] uppercase">
              Awaiting_Transmission
            </h3>
            <p className="text-text-muted/40 text-[10px] font-bold tracking-widest uppercase">
              establishing secure uplink...
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="no-scrollbar relative h-full flex-1 overflow-y-auto scroll-smooth"
      onScroll={handleScroll}
    >
      <div className="mx-auto max-w-[800px] px-6 py-12">
        <div className="flex flex-col gap-6">
          {groupedEvents.map((group) => {
            if (group.type === 'activity') {
              return (
                <ActivityGroup
                  key={group.id}
                  events={group.events}
                  isStreaming={group.isStreaming}
                />
              );
            }

            const { event: e, isStreaming } = group;
            return (
              <div
                key={e.id}
                className="animate-in fade-in slide-in-from-bottom-2 duration-500 ease-out"
              >
                {e.type === 'text' && (
                  <TextCard
                    content={e.data.content}
                    variant={
                      'role' in e.data &&
                      (e.data.role === 'provider' ||
                        e.data.role === 'user' ||
                        e.data.role === 'thought')
                        ? e.data.role
                        : undefined
                    }
                    isStreaming={isStreaming}
                  />
                )}
                {e.type === 'tool_call' && <ToolCallCard tool={e.data.name} payload={e.data} />}
              </div>
            );
          })}

          {/* Fallback Thinking Indicator when nothing has started yet after a user message */}
          {streamingEventId === null && isAwaitingAgent && (
            <div className="animate-in fade-in slide-in-from-left-2 duration-1000">
              <div className="flex w-fit items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 shadow-2xl">
                <Brain className="text-accent h-4 w-4 animate-pulse" />
                <span className="text-accent/80 animate-pulse text-[11px] font-black tracking-[0.2em] uppercase">
                  Agent_Thinking...
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Scroll anchor */}
        <div ref={bottomRef} className="h-24" />
      </div>

      {!autoScroll && (
        <button
          type="button"
          className="group text-text-main hover:bg-accent hover:text-background absolute bottom-12 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/10 bg-white/10 px-4 py-2 text-[10px] font-black tracking-widest uppercase shadow-2xl backdrop-blur-xl transition-all hover:scale-105 active:scale-95"
          onClick={() => {
            setAutoScroll(true);
          }}
        >
          <span className="opacity-60 group-hover:opacity-100">Synchronize_Viewport</span>
        </button>
      )}
    </div>
  );
}
