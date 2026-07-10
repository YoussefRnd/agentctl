import type { ACPEventRow } from '@agentctl/shared';

export interface SubagentGroup {
  subagentEvent: ACPEventRow;
  childEvents: ACPEventRow[];
}

function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  return new Date(v);
}

export function formatDuration(
  start: Date | string | null,
  now: Date | null,
  end: Date | string | null,
): string {
  const startDate = toDate(start);
  if (!startDate) return '--';
  const finish = toDate(end) ?? now;
  if (!finish) return '--';
  const ms = finish.getTime() - startDate.getTime();
  const seconds = ms / 1000;

  if (seconds >= 3600) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${String(h)}h ${String(m)}m ${String(s)}s`;
  }
  if (seconds >= 60) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${String(m)}m ${String(s)}s`;
  }
  if (seconds < 10) {
    return `${seconds.toFixed(1)}s`;
  }
  return `${String(Math.floor(seconds))}s`;
}

export function formatPeek(
  childEvents: ACPEventRow[] | null | undefined,
): string {
  if (!childEvents || childEvents.length === 0) return 'Spawning…';
  const last = childEvents[childEvents.length - 1];

  if (last.type === 'tool_call') {
    const tcData = last.data;
    const toolName = tcData.name;
    const args = tcData.arguments;
    const firstStrArg = args
      ? (Object.values(args).find((v): v is string => typeof v === 'string'))
      : undefined;
    const peek = firstStrArg ? `${toolName} ${firstStrArg}` : toolName;
    return peek.length > 80 ? `${peek.slice(0, 77)}…` : peek;
  }

  if (last.type === 'text' && 'content' in last.data) {
    const content = (last.data as { content: string }).content;
    return content.length > 80 ? `${content.slice(0, 77)}…` : content;
  }

  return 'Spawning…';
}

export interface DotsResult {
  filled: boolean;
  overflow?: number;
}

export function buildProgressDots(
  childEvents: ACPEventRow[] | null | undefined,
): DotsResult[] {
  if (!childEvents) return [];
  const tcEvents = childEvents.filter((e) => e.type === 'tool_call');
  if (tcEvents.length === 0) return [];

  const dots: DotsResult[] = tcEvents.slice(0, 8).map((e) => {
    const data = e.data;
    return { filled: data.status === 'completed' || data.status === 'failed' };
  });

  const overflow = tcEvents.length - 8;
  if (overflow > 0) {
    dots.push({ filled: false, overflow });
  }

  return dots;
}

const STATUS_PRIORITY: Record<string, number> = {
  running: 0,
  spawning: 0,
  failed: 1,
  completed: 2,
};

export function sortSubagentGroups(groups: SubagentGroup[]): SubagentGroup[] {
  return [...groups].sort((a, b) => {
    const dataA = a.subagentEvent.data as { status: string };
    const dataB = b.subagentEvent.data as { status: string };
    const priA = STATUS_PRIORITY[dataA.status] ?? 3;
    const priB = STATUS_PRIORITY[dataB.status] ?? 3;
    if (priA !== priB) return priA - priB;
    const dsA = a.subagentEvent.createdAt;
    const dsB = b.subagentEvent.createdAt;
    return new Date(dsB).getTime() - new Date(dsA).getTime();
  });
}
