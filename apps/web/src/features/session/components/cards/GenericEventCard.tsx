import { Card } from '@agentctl/ui';
import type { ACPEventRow } from '@agentctl/shared';

interface GenericEventCardProps {
  event: ACPEventRow;
}

const EVENT_LABELS: Record<string, string> = {
  status: 'Status',
  mode_update: 'Mode',
  plan_update: 'Plan',
  diff: 'Diff',
  compact: 'Compact',
  terminal_created: 'Terminal',
  terminal_output: 'Terminal output',
  terminal_exit: 'Terminal exit',
  subagent_update: 'Subagent',
};

/**
 * Fallback renderer for canonical event types that have no dedicated card.
 * Guarantees every persisted event is visible rather than silently dropped.
 */
export function GenericEventCard({ event }: GenericEventCardProps) {
  const label = EVENT_LABELS[event.type] ?? event.type;
  let summary = '';
  try {
    summary = JSON.stringify(event.data);
  } catch {
    summary = '[unserializable payload]';
  }
  if (summary.length > 240) summary = `${summary.slice(0, 240)}…`;

  return (
    <Card className="my-2 flex flex-col gap-1 border-white/5 bg-white/[0.02] p-3">
      <div className="flex items-center gap-2">
        <span className="text-text-muted/70 text-[10px] font-bold tracking-wider uppercase">
          {label}
        </span>
        <span className="text-text-muted/40 text-[10px]">#{String(event.id)}</span>
      </div>
      <pre className="text-text-muted/70 overflow-x-auto text-[11px] leading-relaxed break-words whitespace-pre-wrap">
        {summary}
      </pre>
    </Card>
  );
}
