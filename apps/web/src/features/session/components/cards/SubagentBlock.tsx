import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  ChevronRight,
  Search,
  Wrench,
  Eye,
  Bot,
  UserCog,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
} from 'lucide-react';
import { TimelineEvent } from './TimelineEvent';
import { ToolCallCard } from './ToolCallCard';
import { getToolMeta } from '@/shared/lib/toolColors';
import {
  formatDuration,
  formatPeek,
  buildProgressDots,
  sortSubagentGroups,
} from './subagentBlockUtils';
import type { SubagentGroup } from './subagentBlockUtils';
import type { ACPEventSubagentUpdateData } from '@agentctl/shared';

export type { SubagentGroup };

interface SubagentBlockProps {
  subagentGroups: SubagentGroup[];
  isStreaming?: boolean;
  isActive?: boolean;
}

const SUBAGENT_ICONS: Record<string, typeof Bot> = {
  explore: Search,
  builder: Wrench,
  reviewer: Eye,
  general: Bot,
};

function getSubagentIcon(name: string) {
  return SUBAGENT_ICONS[name.toLowerCase()] ?? UserCog;
}

function SubagentCard({
  group,
  isOpen,
  onToggle,
  isStreaming,
  now,
}: {
  group: SubagentGroup;
  isOpen: boolean;
  onToggle: () => void;
  isStreaming?: boolean;
  now: Date | null;
}) {
  const data = group.subagentEvent.data as ACPEventSubagentUpdateData;
  const childEvents = group.childEvents;

  const isRunning = data.status === 'running' || data.status === 'spawning';

  const startDate =
    childEvents.length > 0 ? childEvents[0].createdAt : group.subagentEvent.createdAt;
  const endDate =
    !isRunning && childEvents.length > 0 ? childEvents[childEvents.length - 1].createdAt : null;
  const duration = formatDuration(startDate, now, endDate);

  const peekText = isOpen ? undefined : formatPeek(childEvents);
  const dots = isOpen ? [] : buildProgressDots(childEvents);

  const statusBadge = isRunning ? (
    <span className="text-accent flex items-center gap-1 text-[10px] font-bold tracking-wider uppercase">
      <Loader2 className="h-3 w-3 animate-spin" />
      {data.status === 'spawning' ? 'spawning' : 'running'}
    </span>
  ) : data.status === 'completed' ? (
    <span className="flex items-center gap-1 text-[10px] font-bold tracking-wider text-emerald-400 uppercase">
      <CheckCircle2 className="h-3 w-3" />
      done
    </span>
  ) : (
    <span className="flex items-center gap-1 text-[10px] font-bold tracking-wider text-rose-400 uppercase">
      <XCircle className="h-3 w-3" />
      failed
    </span>
  );

  return (
    <div className="border-border/30 hover:border-accent/20 group mb-2 rounded-lg border bg-white/[0.02] transition-colors">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={onToggle}
        className="flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left"
      >
        <div
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${
            isRunning ? 'border-accent/30 bg-accent/5' : 'border-border/40 bg-surface-secondary/30'
          }`}
        >
          {React.createElement(getSubagentIcon(data.name), {
            className: `h-3 w-3 ${isRunning ? 'text-accent' : 'text-text-muted/60'}`,
          })}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-text-main text-[12px] font-semibold tracking-tight">
              {data.name}
            </span>
            {data.subagentId && (
              <span className="text-text-muted/40 font-mono text-[10px]">
                #{data.subagentId.slice(0, 8)}
              </span>
            )}
          </div>
          <p className="text-text-muted/70 line-clamp-1 text-[12px] leading-tight">{data.scope}</p>
          {peekText && (
            <p className="text-text-muted/50 mt-0.5 line-clamp-1 font-mono text-[12px] leading-tight">
              {peekText}
            </p>
          )}
          {dots.length > 0 && (
            <div className="mt-1 flex items-center gap-[4px]">
              {dots.map((d, i) => {
                if (d.overflow != null) {
                  return (
                    <span key={i} className="text-text-muted/30 text-[9px] leading-none">
                      +{d.overflow}
                    </span>
                  );
                }
                return (
                  <span
                    key={i}
                    className={`inline-block h-1.5 w-1.5 rounded-full ${
                      d.filled ? 'bg-text-muted/50' : 'bg-text-muted/15'
                    }`}
                  />
                );
              })}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <span className="text-text-muted/30 flex items-center gap-1 font-mono text-[10px] tabular-nums">
            <Clock className="h-3 w-3" />
            {duration}
          </span>
          {data.result?.tokensUsed != null && (
            <span className="text-text-muted/40 font-mono text-[10px] tabular-nums">
              {data.result.tokensUsed} tok
            </span>
          )}
          {statusBadge}
          <ChevronRight
            className={`text-text-muted/40 h-3.5 w-3.5 transition-transform duration-150 ${
              isOpen ? 'rotate-90' : ''
            }`}
          />
        </div>
      </button>

      <div
        className={`grid transition-colors duration-150 ${
          isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        }`}
      >
        <div className="overflow-hidden">
          {childEvents.length > 0 && (
            <div className="border-border/20 mr-3 ml-12 border-t pb-2 pl-2">
              {childEvents.map((e, index) => {
                const childTotal = childEvents.length;
                const isOnly = childTotal === 1;
                const isFirst = index === 0;
                const isLast = index === childTotal - 1;
                const isLastStreaming = isStreaming && index === childTotal - 1;
                const isChildFailed = e.type === 'tool_call' && e.data.status === 'failed';

                if (e.type === 'text' && 'content' in e.data) {
                  const textData = e.data as { content: string; role?: string };
                  return (
                    <TimelineEvent
                      key={e.id}
                      dotColor={textData.role === 'thought' ? 'bg-accent' : 'bg-text-muted/30'}
                      isPulsing={isLastStreaming}
                      position={isOnly ? 'only' : isFirst ? 'first' : isLast ? 'last' : 'middle'}
                    >
                      <span
                        className={`text-text-muted/80 text-[13px] leading-relaxed select-text ${
                          isChildFailed ? 'border-l-2 border-rose-500/50 pl-2' : ''
                        }`}
                      >
                        {textData.content}
                      </span>
                      {isLastStreaming && (
                        <span className="bg-accent/40 ml-1 inline-block h-3 w-1 animate-pulse align-middle" />
                      )}
                    </TimelineEvent>
                  );
                }

                if (e.type === 'tool_call') {
                  const payload = e.data;
                  const toolName = payload.name;
                  const isFailedTool = payload.status === 'failed';
                  return (
                    <TimelineEvent
                      key={e.id}
                      dotColor={
                        isFailedTool ? 'bg-rose-500' : getToolMeta(payload.kind, toolName).dotColor
                      }
                      isPulsing={isLastStreaming}
                      position={isOnly ? 'only' : isFirst ? 'first' : isLast ? 'last' : 'middle'}
                    >
                      <div
                        className={isFailedTool ? 'border-l-2 border-rose-500/50 pl-2' : undefined}
                      >
                        <ToolCallCard
                          tool={toolName}
                          payload={payload}
                          isStreaming={isLastStreaming}
                        />
                      </div>
                    </TimelineEvent>
                  );
                }

                return null;
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function SubagentBlock({ subagentGroups, isStreaming = false }: SubagentBlockProps) {
  const [openMap, setOpenMap] = useState<Partial<Record<string, boolean>>>({});
  const [forceAllOpen, setForceAllOpen] = useState<boolean | undefined>(undefined);
  const focusedIndexRef = useRef(0);
  const [now, setNow] = useState<Date | null>(null);

  const sorted = useMemo(() => sortSubagentGroups(subagentGroups), [subagentGroups]);

  const hasRunning = useMemo(
    () =>
      sorted.some((g) => {
        const data = g.subagentEvent.data as ACPEventSubagentUpdateData;
        return data.status === 'running' || data.status === 'spawning';
      }),
    [sorted],
  );

  useEffect(() => {
    if (!hasRunning) {
      setNow(null);
      return;
    }
    const id = setInterval(() => {
      setNow(new Date());
    }, 250);
    return () => {
      clearInterval(id);
    };
  }, [hasRunning]);

  const toggleOne = useCallback((subId: string) => {
    setForceAllOpen(undefined);
    setOpenMap((prev) => ({ ...prev, [subId]: !prev[subId] }));
  }, []);

  const expandAll = useCallback(() => {
    setForceAllOpen(true);
    setOpenMap({});
  }, []);

  const collapseAll = useCallback(() => {
    setForceAllOpen(false);
    setOpenMap({});
  }, []);

  const allExpanded = sorted.every((g) => {
    const data = g.subagentEvent.data as ACPEventSubagentUpdateData;
    const subId = data.subagentId;
    return openMap[subId] ?? (data.status === 'failed' ? true : (forceAllOpen ?? false));
  });

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const max = sorted.length - 1;
      if (max < 0) return;

      const safeIndex = Math.min(focusedIndexRef.current, max);

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const dir = e.key === 'ArrowUp' ? -1 : 1;
        const next = Math.max(0, Math.min(max, safeIndex + dir));
        focusedIndexRef.current = next;
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const data = sorted[safeIndex].subagentEvent.data as ACPEventSubagentUpdateData;
        toggleOne(data.subagentId);
      } else if (e.key === 'e') {
        expandAll();
      } else if (e.key === 'c') {
        collapseAll();
      }
    },
    [sorted, toggleOne, expandAll, collapseAll],
  );

  // Only auto-scroll when a new running subagent appears (single pass)
  const runningIds = useMemo(() => {
    const ids: string[] = [];
    for (const g of sorted) {
      const data = g.subagentEvent.data as ACPEventSubagentUpdateData;
      if (data.status === 'running' || data.status === 'spawning') {
        ids.push(data.subagentId);
      }
    }
    return ids.join(',');
  }, [sorted]);

  useEffect(() => {
    if (!runningIds) return;
    const runningEl = document.querySelector(`[data-sortable-subagent="running"]`);
    if (runningEl) {
      const rect = runningEl.getBoundingClientRect();
      const isVisible = rect.top >= 0 && rect.bottom <= window.innerHeight;
      if (!isVisible) {
        runningEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }, [runningIds]);

  if (sorted.length === 0) return null;

  return (
    <div
      tabIndex={0}
      role="listbox"
      aria-label="Subagent responses"
      onKeyDown={handleKeyDown}
      className="focus-visible:ring-accent/30 mb-4 rounded-lg focus:outline-none focus-visible:ring-1"
    >
      <div className="text-text-muted/40 mb-2 flex items-center gap-2 text-[10px] font-bold tracking-[0.15em] uppercase">
        Subagents ({sorted.length})
        <button
          type="button"
          onClick={allExpanded ? collapseAll : expandAll}
          className="text-text-muted/30 hover:text-text-muted/60 cursor-pointer font-normal tracking-normal lowercase transition-colors"
        >
          {allExpanded ? 'collapse all' : 'expand all'}
        </button>
      </div>
      {sorted.map((group) => {
        const data = group.subagentEvent.data as ACPEventSubagentUpdateData;
        const subId = data.subagentId;
        const isOpen =
          openMap[subId] ?? (data.status === 'failed' ? true : (forceAllOpen ?? false));
        const isRunningSub = data.status === 'running' || data.status === 'spawning';
        return (
          <div key={subId} data-sortable-subagent={isRunningSub ? 'running' : undefined}>
            <SubagentCard
              group={group}
              isOpen={isOpen}
              onToggle={() => {
                toggleOne(subId);
              }}
              isStreaming={isStreaming && isOpen}
              now={now}
            />
          </div>
        );
      })}
    </div>
  );
}
