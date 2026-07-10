import { useRef, useState, useCallback, useMemo } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { Brain } from 'lucide-react';
import { TextCard } from './cards/TextCard';
import { AgentResponse } from './cards/AgentResponse';
import { CommandResultCard } from './cards/CommandResultCard';
import type { ACPEventRow } from '@agentctl/shared';
import { useSession, useSessionStream } from '../../../contexts/SessionContext';
import { Card } from '@agentctl/ui';
import type { RewindMode } from './RewindMenu';

interface EventFeedProps {
  events: ACPEventRow[];
  isConnected?: boolean;
  hasGitRepo?: boolean;
  isSessionRunning?: boolean;
  onRewind?: (eventId: number, mode: RewindMode) => void;
}

export function EventFeed({
  events,
  isConnected = true,
  hasGitRepo,
  isSessionRunning,
  onRewind,
}: EventFeedProps) {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const { sessionData } = useSession();
  const { streamingEventId, queuedMessages, dequeueMessage } = useSessionStream();
  const isSessionError = sessionData?.session.status === 'error';

  const groupedEvents = useMemo(() => {
    const result: (
      | { type: 'user'; event: ACPEventRow; isStreaming: boolean }
      | { type: 'agent'; events: ACPEventRow[]; isStreaming: boolean; id: string }
      | { type: 'command'; event: ACPEventRow; isStreaming: boolean }
    )[] = [];
    let currentAgentTurn: {
      type: 'agent';
      events: ACPEventRow[];
      isStreaming: boolean;
      id: string;
    } | null = null;

    for (const e of events) {
      const isStreaming = e.id === streamingEventId;

      if (e.type === 'status' && (e.data as { status?: string }).status === 'command_result') {
        currentAgentTurn = null;
        result.push({ type: 'command', event: e, isStreaming });
        continue;
      }

      const isUser = e.type === 'text' && 'role' in e.data && e.data.role === 'user';

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

  const latestAgentGroupId = useMemo(() => {
    if (groupedEvents.length === 0) return null;
    const lastGroup = groupedEvents[groupedEvents.length - 1];
    if (lastGroup.type === 'agent') {
      return lastGroup.id;
    }
    return null;
  }, [groupedEvents]);

  const atBottomStateChange = useCallback((atBottom: boolean) => {
    setAutoScroll(atBottom);
  }, []);

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
            <p className="text-text-muted/50 text-[11px] tracking-wide">Send a message to begin.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-grow flex-col overflow-hidden" role="log" aria-live="polite" aria-label="Session event feed">
      <Virtuoso
        ref={virtuosoRef}
        className="no-scrollbar h-full w-full flex-grow"
        data={groupedEvents}
        defaultItemHeight={100}
        initialTopMostItemIndex={groupedEvents.length > 0 ? groupedEvents.length - 1 : 0}
        followOutput={autoScroll ? 'smooth' : false}
        atBottomStateChange={atBottomStateChange}
        itemContent={(index, group) => (
          <div className="mx-auto max-w-[800px] px-6">
            <div className="py-3">
              {group.type === 'command' ? (
                (() => {
                  const data = group.event.data as {
                    command?: string;
                    args?: Record<string, unknown>;
                    commandStatus?: string;
                  };
                  return (
                    <div className="animate-in fade-in slide-in-from-bottom-2 my-2 duration-500 ease-out">
                      <CommandResultCard
                        command={data.command ?? 'unknown'}
                        args={data.args}
                        status={data.commandStatus}
                        isStreaming={group.isStreaming}
                      />
                    </div>
                  );
                })()
              ) : group.type === 'agent' ? (
                <div className="animate-in fade-in slide-in-from-bottom-2 my-2 duration-500 ease-out">
                  <AgentResponse
                    events={group.events}
                    isStreaming={group.isStreaming}
                    isActive={group.id === latestAgentGroupId}
                  />
                </div>
              ) : (
                (() => {
                  const { event: e, isStreaming } = group;
                  return (
                    <div className="animate-in fade-in slide-in-from-bottom-2 my-2 duration-500 ease-out">
                      <TextCard
                        content={(e.data as { content: string }).content}
                        variant="user"
                        isStreaming={isStreaming}
                        eventId={e.id}
                        hasGitRepo={hasGitRepo}
                        isSessionRunning={isSessionRunning}
                        onRewind={onRewind}
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
                })()
              )}
            </div>
          </div>
        )}
        components={{
          Footer: () => (
            <>
              {isSessionError && (
                <div className="mx-auto max-w-[800px] px-6 pb-4">
                  <div className="animate-in fade-in slide-in-from-left-2 duration-500">
                    <Card status="error" className="flex flex-col gap-3 p-5">
                      <div className="flex items-center gap-3">
                        <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-rose-500/25 bg-rose-500/8 text-rose-400">
                          <Brain className="h-4 w-4" />
                        </div>
                        <span className="text-[11px] font-bold tracking-[0.2em] text-rose-400 uppercase">
                          Connection failed
                        </span>
                      </div>
                      <p className="text-text-muted/80 text-[12px] leading-relaxed">
                        The agent runtime process crashed or failed to resuscitate.
                      </p>
                      <div className="mt-1 flex items-center gap-4">
                        <button
                          type="button"
                          onClick={() => {
                            window.location.reload();
                          }}
                          className="cursor-pointer rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-1.5 text-[10px] font-bold tracking-wider text-rose-300 uppercase transition-all hover:bg-rose-500/20"
                        >
                          Retry Connection
                        </button>
                        <span className="text-text-muted/40 text-[10px] font-medium">
                          (Or type a message to attempt resuscitation)
                        </span>
                      </div>
                    </Card>
                  </div>
                </div>
              )}
              {queuedMessages.map((msg, index) => (
                <div key={msg.id} className="mx-auto max-w-[800px] px-6 pb-4">
                  <div className="animate-in fade-in slide-in-from-bottom-2 border-accent/40 group relative my-2 flex items-start justify-between rounded-r-lg border-l-2 border-dashed bg-white/[0.01] py-2 pl-4 duration-500 ease-out hover:bg-white/[0.02]">
                    <div className="min-w-0 flex-1 pr-16">
                      <span className="text-accent mb-1 block text-[10px] font-bold tracking-wider uppercase">
                        Queued (#{index + 1})
                      </span>
                      <p className="text-text-muted/80 text-[14px] whitespace-pre-wrap">
                        {msg.text}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        dequeueMessage(msg.id);
                      }}
                      className="cursor-pointer rounded border border-rose-500/20 bg-rose-500/5 px-2 py-1 text-[10px] font-extrabold text-rose-400 uppercase transition-all select-none hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-300"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ))}
            </>
          ),
        }}
      />

      {!autoScroll && (
        <button
          type="button"
          className="group text-text-main hover:bg-accent hover:text-background absolute bottom-6 left-1/2 z-50 flex -translate-x-1/2 cursor-pointer items-center gap-2 rounded-full border border-white/10 bg-white/8 px-4 py-2 text-[10px] font-medium tracking-wide shadow-sm backdrop-blur-xl transition-all hover:scale-105 active:scale-95"
          onClick={() => {
            setAutoScroll(true);
            virtuosoRef.current?.scrollToIndex({
              index: groupedEvents.length - 1,
              behavior: 'smooth',
            });
          }}
        >
          <span className="opacity-60 group-hover:opacity-100">Scroll to bottom</span>
        </button>
      )}
    </div>
  );
}
