import { AlertCircle, Check, Circle, ShieldQuestion } from 'lucide-react';
import { cn } from '@agentctl/ui';
import { subagentDisplayStatus, type SubagentGroup } from '../lib/subagentBlockUtils';

export function SubagentStatus({
  group,
  isConnected,
}: {
  group: SubagentGroup;
  isConnected: boolean;
}) {
  const status = subagentDisplayStatus(group, isConnected);
  const approval = status === 'Needs approval';
  const failed = status === 'Failed' || status === 'Idle · Error';
  const completed = status === 'Completed';
  const running = status === 'Running' || status === 'Starting';
  const Icon = approval ? ShieldQuestion : failed ? AlertCircle : completed ? Check : Circle;
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 text-xs',
        approval
          ? 'text-amber-400'
          : failed
            ? 'text-rose-400'
            : completed
              ? 'text-emerald-400'
              : running
                ? 'text-accent'
                : 'text-text-muted',
      )}
    >
      <Icon aria-hidden className="h-3.5 w-3.5 shrink-0" />
      {status}
    </span>
  );
}
