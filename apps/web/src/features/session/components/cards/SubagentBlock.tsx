import { useState, useEffect, useMemo } from 'react';
import { ChevronRight, AlertCircle, Loader2 } from 'lucide-react';
import { StreamingDots, useUIStore } from '@/shared';
import {
  formatDuration,
  formatToolTitlePeek,
  formatSubagentTitle,
  sortSubagentGroups,
} from './subagentBlockUtils';
import type { SubagentGroup } from './subagentBlockUtils';
import type { SessionEventSubagentUpdateData } from '@agentctl/shared';

export type { SubagentGroup };

interface SubagentBlockProps {
  subagentGroups: SubagentGroup[];
  isStreaming?: boolean;
  isActive?: boolean;
}

function SubagentCard({
  group,
  onSelect,
  isStreaming,
  now,
}: {
  group: SubagentGroup;
  onSelect: () => void;
  isStreaming?: boolean;
  now: Date | null;
}) {
  const data = group.subagentEvent.data as SessionEventSubagentUpdateData;
  const childEvents = group.childEvents;
  const isRunning = data.status === 'running' || data.status === 'spawning';
  const isFailed = data.status === 'failed';

  const startDate =
    childEvents.length > 0 ? childEvents[0].createdAt : group.subagentEvent.createdAt;
  const endDate =
    !isRunning && childEvents.length > 0 ? childEvents[childEvents.length - 1].createdAt : null;
  const duration = formatDuration(startDate, now, endDate);
  const toolPeek = formatToolTitlePeek(childEvents);
  const title = formatSubagentTitle(data.name);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`border-border/30 bg-surface-secondary/20 hover:border-accent/40 hover:bg-surface-secondary/40 group relative mb-2 flex cursor-pointer items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 transition-[border-color,background-color,transform] duration-150 active:scale-[0.98] ${
        isFailed ? 'border-rose-500/30' : ''
      }`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        {/* Status Indicator for running or error */}
        {(isRunning || isFailed) && (
          <div className="flex shrink-0 items-center justify-center">
            {isRunning ? (
              <div className="relative flex h-3.5 w-3.5 items-center justify-center">
                <Loader2 className="text-accent h-3.5 w-3.5 animate-spin" />
              </div>
            ) : (
              <div className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-rose-500/20 text-rose-400">
                <AlertCircle className="h-3 w-3" />
              </div>
            )}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {/* Title (1st char uppercase) */}
            <span className="text-text-main text-[13px] font-semibold tracking-tight">{title}</span>

            {/* Live tool execution chip */}
            {isRunning && toolPeek && (
              <span className="text-accent bg-accent/10 border-accent/20 inline-flex max-w-[320px] items-center gap-1.5 truncate rounded px-2 py-0.5 font-mono text-[11px]">
                <span className="truncate">{toolPeek}</span>
                {isStreaming && <StreamingDots className="text-accent ml-0.5" />}
              </span>
            )}
          </div>

          {/* Task it should do */}
          {data.scope && (
            <p className="text-text-muted/70 mt-0.5 line-clamp-1 text-[11.5px] leading-tight">
              {data.scope}
            </p>
          )}
        </div>
      </div>

      {/* Duration & Expand chevron */}
      <div className="flex shrink-0 items-center gap-2 pl-2">
        <span className="text-text-muted/50 font-mono text-[11px] tabular-nums">{duration}</span>
        <ChevronRight className="text-text-muted/40 group-hover:text-text-main h-3.5 w-3.5 transition-colors" />
      </div>
    </div>
  );
}

export function SubagentBlock({ subagentGroups, isStreaming = false }: SubagentBlockProps) {
  const setActiveSubagent = useUIStore((s) => s.setActiveSubagent);
  const [now, setNow] = useState<Date>(() => new Date());

  const sorted = useMemo(() => sortSubagentGroups(subagentGroups), [subagentGroups]);
  const hasRunning = sorted.some((g) => {
    const data = g.subagentEvent.data as SessionEventSubagentUpdateData;
    return data.status === 'running' || data.status === 'spawning';
  });

  useEffect(() => {
    if (!hasRunning) return;
    const id = setInterval(() => {
      setNow(new Date());
    }, 250);
    return () => clearInterval(id);
  }, [hasRunning]);

  if (sorted.length === 0) return null;

  return (
    <div className="mb-3">
      {sorted.map((group) => {
        const data = group.subagentEvent.data as SessionEventSubagentUpdateData;
        const subId = data.subagentId;
        return (
          <SubagentCard
            key={subId}
            group={group}
            onSelect={() => setActiveSubagent(group)}
            isStreaming={isStreaming}
            now={now}
          />
        );
      })}
    </div>
  );
}
