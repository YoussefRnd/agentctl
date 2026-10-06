import { useEffect, useRef } from 'react';
import { formatDuration, isSubagentActive, type SubagentGroup } from '../lib/subagentBlockUtils';
import type { SessionEventSubagentUpdateData } from '@agentctl/shared';

/** Update only the timer text, rather than re-rendering every card each tick. */
export function SubagentElapsed({
  group,
  isConnected = true,
}: {
  group: SubagentGroup;
  isConnected?: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const data = group.subagentEvent.data as SessionEventSubagentUpdateData;
  const start = group.startedAt ?? group.subagentEvent.createdAt;
  const active = !data.historical && isConnected && isSubagentActive(data.status);
  const end =
    group.endedAt ??
    (!active ? (group.childEvents.at(-1)?.createdAt ?? group.subagentEvent.createdAt) : null);
  useEffect(() => {
    const update = () => {
      if (ref.current) ref.current.textContent = formatDuration(start, new Date(), end);
    };
    update();
    if (!active) return;
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [start, end, active]);
  return (
    <span
      ref={ref}
      aria-label="Elapsed time"
      className="text-text-muted/60 font-mono text-[11px] tabular-nums"
    />
  );
}
