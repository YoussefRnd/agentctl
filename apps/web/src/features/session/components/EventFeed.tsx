import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { Brain } from 'lucide-react';
import { TextCard } from './cards/TextCard';
import { AgentResponse } from './cards/AgentResponse';
import type { ACPEventRow } from '@agentctl/shared';
import { useSession, useSessionStream } from '../../../contexts/SessionContext';

export function EventFeed({ events, isConnected = true }: { events: ACPEventRow[]; isConnected?: boolean }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const { sessionData } = useSession();
  const { streamingEventId } = useSessionStream();
  const isSessionError = sessionData?.session.status === 'error';


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
      | { type: 'user'; event: ACPEventRow; isStreaming: boolean }
      | { type: 'agent'; events: ACPEventRow[]; isStreaming: boolean; id: string }
    )[] = [];
    let currentAgentTurn: {
      type: 'agent';
      events: ACPEventRow[];
      isStreaming: boolean;
      id: string;
    } | null = null;

    for (const e of events) {
      const isUser = e.type === 'text' && 'role' in e.data && e.data.role === 'user';
      const isStreaming = e.id === streamingEventId;

      if (isUser) {
        currentAgentTurn = null;
        result.push({ type: 'user', event: e, isStreaming });
      } else {
        if (!currentAgentTurn) {
          currentAgentTurn = {
            type: 'agent',
            events: [e],
            isStreaming,
            id: `agent-turn-${String(e.id)}`,
          };
          result.push(currentAgentTurn);
        } else {
          currentAgentTurn.events.push(e);
          if (isStreaming) currentAgentTurn.isStreaming = true;
        }
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
    if (!isConnected) {
      return (
        <div className="flex h-full items-center justify-center py-20">
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="relative h-12 w-12">
              <div className="absolute inset-0 rounded-full border-2 border-white/5" />
              <div className="border-accent absolute inset-0 animate-spin rounded-full border-2 border-t-transparent" />
            </div>
            <div className="space-y-1">
              <h3 className="text-text-main text-[12px] font-semibold tracking-[0.1em] uppercase">
                Connecting...
              </h3>
              <p className="text-text-muted/40 text-[10px] tracking-wide">
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
            <h3 className="text-text-main text-[13px] font-semibold tracking-[0.1em] uppercase">
              Session ready
            </h3>
            <p className="text-text-muted/50 text-[11px] tracking-wide">
              Send a message to begin.
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
      <div className="mx-auto max-w-[800px] px-6 pt-12 pb-4">
        <div className="flex flex-col gap-6">
          {groupedEvents.map((group) => {
            if (group.type === 'agent') {
              return (
                <AgentResponse
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
                <TextCard
                  content={(e.data as { content: string }).content}
                  variant="user"
                  isStreaming={isStreaming}
                  attachments={
                    (
                      e.data as {
                        attachments?: {
                          attachmentId: string;
                          mimeType: string;
                          filename: string;
                          sizeBytes: number;
                        }[];
                      }
                    ).attachments
                  }
                />
              </div>
            );
          })}

          {/* Fallback Thinking Indicator when nothing has started yet after a user message */}
          {streamingEventId === null && isAwaitingAgent && !isSessionError && (
            <div className="animate-in fade-in slide-in-from-left-2 duration-1000">
              <div className="flex w-fit items-center gap-3 rounded-lg border border-white/8 bg-white/4 px-4 py-2.5">
                <Brain className="text-accent h-4 w-4 animate-pulse" />
                <span className="text-accent/70 text-[11px] font-bold tracking-[0.2em] uppercase">
                  Agent thinking...
                </span>
              </div>
            </div>
          )}

          {/* Error notification card in the feed */}
          {isSessionError && (
            <div className="animate-in fade-in slide-in-from-left-2 duration-500">
              <div className="flex flex-col gap-3 rounded-xl border border-rose-500/15 bg-rose-500/5 p-5 backdrop-blur-md">
                <div className="flex items-center gap-3">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-rose-500/25 bg-rose-500/8 text-rose-400">
                    <Brain className="h-4 w-4" />
                  </div>
                  <span className="text-rose-400 text-[11px] font-bold tracking-[0.2em] uppercase">
                    Connection failed
                  </span>
                </div>
                <p className="text-text-muted/80 text-[12px] leading-relaxed">
                  The agent runtime process crashed or failed to resuscitate. This typically happens when the agent binary is not found, launch credentials/API keys are missing or invalid, or the process exited unexpectedly.
                </p>
                <div className="mt-1 flex items-center gap-4">
                  <button
                    type="button"
                    onClick={() => {
                      window.location.reload();
                    }}
                    className="border-rose-500/20 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 rounded-lg border px-3 py-1.5 text-[10px] font-bold tracking-wider uppercase transition-all"
                  >
                    Retry Connection
                  </button>
                  <span className="text-text-muted/40 text-[10px] font-medium">
                    (Or type a message to attempt resuscitation)
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Scroll anchor */}
        <div ref={bottomRef} className="h-6" />
      </div>

      {!autoScroll && (
        <button
          type="button"
          className="group text-text-main hover:bg-accent hover:text-background absolute bottom-12 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/10 bg-white/8 px-4 py-2 text-[10px] font-medium tracking-wide shadow-sm backdrop-blur-xl transition-all hover:scale-105 active:scale-95"
          onClick={() => {
            setAutoScroll(true);
          }}
        >
          <span className="opacity-60 group-hover:opacity-100">Scroll to bottom</span>
        </button>
      )}
    </div>
  );
}
