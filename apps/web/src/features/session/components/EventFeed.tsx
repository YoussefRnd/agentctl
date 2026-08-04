import { useRef, useState, useCallback, useMemo } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { Brain, RefreshCw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { TextCard } from './cards/TextCard';
import { AgentResponse } from './cards/AgentResponse';
import { CommandResultCard } from './cards/CommandResultCard';
import { ElicitationCard } from './cards/ElicitationCard';
import type { ACPEventRow, ElicitationItem } from '@agentctl/shared';
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
  const { sessionData, sessionId } = useSession();
  const { streamingEventId } = useSessionStream();
  const isSessionError = sessionData?.session.status === 'error';
  const queryClient = useQueryClient();

  const groupedEvents = useMemo(() => {
    const result: (
      | { type: 'user'; event: ACPEventRow; isStreaming: boolean }
      | { type: 'agent'; events: ACPEventRow[]; isStreaming: boolean; id: string }
      | { type: 'command'; event: ACPEventRow; isStreaming: boolean }
      | { type: 'elicitation'; event: ACPEventRow; isStreaming: boolean }
    )[] = [];
    let currentAgentTurn: {
      type: 'agent';
      events: ACPEventRow[];
      isStreaming: boolean;
      id: string;
    } | null = null;

    for (const e of events) {
      const statusVal = (e.data as { status?: string } | null)?.status;
      const isHiddenSystemEvent =
        e.type === 'status' &&
        typeof statusVal === 'string' &&
        [
          'available_commands_update',
          'config_option_update',
          'session_info_update',
          'turn_end',
        ].includes(statusVal);

      if (isHiddenSystemEvent) {
        continue;
      }

      const isStreaming = e.id === streamingEventId;

      if (e.type === 'status' && (e.data as { status?: string }).status === 'command_result') {
        currentAgentTurn = null;
        result.push({ type: 'command', event: e, isStreaming });
        continue;
      }

      if (
        e.type === 'status' &&
        (e.data as { status?: string }).status === 'elicitation_requested'
      ) {
        currentAgentTurn = null;
        result.push({ type: 'elicitation', event: e, isStreaming });
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
                    <div className="my-2">
                      <CommandResultCard
                        command={data.command ?? 'unknown'}
                        args={data.args}
                        status={data.commandStatus}
                        isStreaming={group.isStreaming}
                      />
                    </div>
                  );
                })()
              ) : group.type === 'elicitation' ? (
                (() => {
                  const data = group.event.data as {
                    elicitation?: ElicitationItem;
                  };
                  if (!data.elicitation) return null;
                  return (
                    <div className="my-2">
                      <ElicitationCard
                        elicitation={data.elicitation}
                        onRespond={(id, resp) => {
                          if (!sessionData?.session.id) return;
                          void fetch(
                            `/api/sessions/${sessionData.session.id}/elicitations/${id}/respond`,
                            {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify(resp),
                            },
                          );
                        }}
                      />
                    </div>
                  );
                })()
              ) : group.type === 'agent' ? (
                <div className="my-2">
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
                    <div className="my-2">
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
                          className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/15 px-3 py-1.5 text-[11px] font-bold text-rose-300 transition-all hover:bg-rose-500/25"
                        >
                          <RefreshCw className="h-3 w-3" />
                          Reconnect Stream
                        </button>
                      </div>
                    </Card>
                  </div>
                </div>
              )}
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
