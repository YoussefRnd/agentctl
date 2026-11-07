import { useTabNavigation } from '@agentctl/ui';
import { ArrowUpRight } from 'lucide-react';
import { useSubagentStore } from '../model/useSubagentStore';
import {
  formatSubagentTitle,
  getSubagentGroupKey,
  sortSubagentGroups,
  subagentProgress,
} from '../lib/subagentBlockUtils';
import { SubagentElapsed } from './SubagentElapsed';
import { SubagentStatus } from './SubagentStatus';
import type { SubagentGroup } from '../lib/subagentBlockUtils';
import type { SessionEventSubagentUpdateData } from '@agentctl/shared';

export type { SubagentGroup };

interface SubagentBlockProps {
  subagentGroups: SubagentGroup[];
  isStreaming?: boolean;
  isActive?: boolean;
  isConnected?: boolean;
}

export function SubagentBlock({ subagentGroups, isConnected = true }: SubagentBlockProps) {
  const select = useSubagentStore((state) => state.setActiveSubagentId);
  const selected = useSubagentStore((state) => state.activeSubagentId);
  const selectedSession = useSubagentStore((state) => state.activeSessionId);
  const groups = sortSubagentGroups(subagentGroups);
  const navigation = useTabNavigation({
    value: groups.find(
      (group) =>
        getSubagentGroupKey(group) === selected &&
        group.subagentEvent.sessionId === selectedSession,
    )
      ? selected
      : null,
    items: groups.map(getSubagentGroupKey),
    orientation: 'vertical',
    selectionMode: 'buttons',
    onValueChange: (key) => {
      const group = groups.find((group) => getSubagentGroupKey(group) === key);
      if (group) select(key, group.subagentEvent.sessionId);
    },
  });
  if (!groups.length) return null;
  return (
    <div
      {...navigation.getListProps()}
      className="border-border/40 bg-surface-secondary/10 overflow-hidden rounded-lg border"
      aria-label="Delegated tasks"
    >
      {groups.map((group) => {
        const data = group.subagentEvent.data as SessionEventSubagentUpdateData;
        const preview = subagentProgress(group).replace(/\s+/g, ' ').trim();
        const title = formatSubagentTitle(data.name);
        const key = getSubagentGroupKey(group);
        return (
          <button
            {...navigation.getItemProps(key)}
            key={key}
            aria-label={`Inspect ${title}`}
            className="border-border/30 hover:bg-surface-secondary/50 aria-pressed:bg-accent/5 focus-visible:ring-accent/50 flex w-full items-center gap-3 border-b px-3 py-2.5 text-left last:border-b-0 focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
          >
            <span className="min-w-0 flex-1">
              <span className="text-text-main block truncate text-[13px] font-medium">{title}</span>
              <span className="text-text-muted mt-1 block truncate text-xs">
                {preview || 'Open conversation'}
              </span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1">
              <SubagentStatus group={group} isConnected={isConnected} />
              <SubagentElapsed group={group} isConnected={isConnected} />
            </span>
            <ArrowUpRight aria-hidden className="text-text-muted/60 h-3.5 w-3.5 shrink-0" />
          </button>
        );
      })}
    </div>
  );
}
