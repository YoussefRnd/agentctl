import type {
  ACPEventRow,
  ACPEventToolCallData,
  ACPEventSubagentUpdateData,
} from '@agentctl/shared';

export interface SubagentGroup {
  subagentEvent: ACPEventRow;
  childEvents: ACPEventRow[];
}

export type SubagentFilter = 'all' | 'running' | 'completed' | 'failed';

export function formatSubagentTitle(name?: string): string {
  if (!name) return 'Subagent';
  const cleaned = name.replace(/[-_]/g, ' ').trim();
  if (!cleaned) return 'Subagent';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export function isSubagentToolCall(data: ACPEventToolCallData): boolean {
  // Protocol-level kind tag
  if ((data.kind as string) === 'subagent' || (data.kind as string) === 'task') return true;

  // Subagent-specific argument attributes
  const args = data.arguments;
  if (
    args &&
    (typeof args.subagent_type === 'string' ||
      typeof args.agent_type === 'string' ||
      typeof args.subagent === 'string')
  ) {
    return true;
  }

  // Common tool names used when providers emit tool_calls instead of native subagent_update
  const name = data.name.toLowerCase();
  return (
    name === 'task' ||
    name === 'subagent' ||
    name === 'invoke_subagent' ||
    name.includes('subagent')
  );
}

export function getSubagentTitleFromData(data: ACPEventToolCallData): string {
  if (data.title) return formatSubagentTitle(data.title);
  const args = data.arguments;
  if (args) {
    if (typeof args.description === 'string' && args.description && args.description.length < 60) {
      return formatSubagentTitle(args.description);
    }
    if (typeof args.title === 'string' && args.title) return formatSubagentTitle(args.title);
    if (typeof args.Role === 'string' && args.Role) return formatSubagentTitle(args.Role);
    if (typeof args.TypeName === 'string' && args.TypeName)
      return formatSubagentTitle(args.TypeName);
    if (typeof args.subagent_type === 'string' && args.subagent_type)
      return formatSubagentTitle(args.subagent_type);
    if (typeof args.name === 'string' && args.name) return formatSubagentTitle(args.name);
  }
  return formatSubagentTitle(data.name);
}

export function getSubagentScopeFromData(data: ACPEventToolCallData): string {
  const args = data.arguments;
  if (args) {
    if (typeof args.Prompt === 'string') return args.Prompt;
    if (typeof args.prompt === 'string') return args.prompt;
    if (typeof args.task === 'string') return args.task;
    if (typeof args.description === 'string') return args.description;
    if (typeof args.command === 'string') return args.command;
  }
  return data.title || '';
}

export function extractSubagentGroups(events: ACPEventRow[]): SubagentGroup[] {
  const idToEvent = new Map<number, ACPEventRow>();
  const idToIndex = new Map<number, number>();
  for (let i = 0; i < events.length; i++) {
    idToEvent.set(events[i].id, events[i]);
    idToIndex.set(events[i].id, i);
  }

  const toolCallGroups = new Map<string, ACPEventRow[]>();
  const nativelyEmitted = new Map<string, ACPEventRow[]>();

  for (const e of events) {
    if (e.type === 'tool_call') {
      const tcData = e.data as ACPEventToolCallData;
      if (tcData.toolCallId && isSubagentToolCall(tcData)) {
        const group = toolCallGroups.get(tcData.toolCallId);
        if (group) {
          group.push(e);
        } else {
          toolCallGroups.set(tcData.toolCallId, [e]);
        }
      }
    }

    if (e.type === 'subagent_update') {
      const data = e.data as { subagentId: string };
      if (!nativelyEmitted.has(data.subagentId)) {
        nativelyEmitted.set(data.subagentId, []);
      }
    } else if (e.parentEventId != null) {
      const parentData = idToEvent.get(e.parentEventId);
      if (parentData && parentData.type === 'subagent_update') {
        const data = parentData.data as { subagentId: string };
        const children = nativelyEmitted.get(data.subagentId);
        if (children) {
          children.push(e);
          continue;
        }
      }
    }
  }

  const groups: SubagentGroup[] = [];

  for (const [, tcEvents] of toolCallGroups) {
    const first = tcEvents[0];
    const last = tcEvents[tcEvents.length - 1];
    const firstData = first.data as ACPEventToolCallData;
    const lastData = last.data as ACPEventToolCallData;

    const lastTcIndex = idToIndex.get(last.id) ?? -1;
    let hasFollowingActivity = false;
    if (lastTcIndex !== -1) {
      for (let i = lastTcIndex + 1; i < events.length; i++) {
        const e = events[i];
        if (e.type === 'tool_call') {
          const ed = e.data as ACPEventToolCallData;
          if (ed.toolCallId && toolCallGroups.has(ed.toolCallId)) continue;
        }
        hasFollowingActivity = true;
        break;
      }
    }

    const status =
      lastData.status === 'completed' || lastData.status === 'failed'
        ? lastData.status
        : hasFollowingActivity
          ? 'completed'
          : 'running';

    groups.push({
      subagentEvent: {
        ...first,
        type: 'subagent_update' as const,
        data: {
          subagentId: `tool-${firstData.toolCallId ?? 'unknown'}`,
          name: getSubagentTitleFromData(firstData),
          scope: getSubagentScopeFromData(firstData),
          status,
          result:
            status === 'completed'
              ? {
                  summary:
                    typeof lastData.rawOutput === 'string' ? lastData.rawOutput : 'Task completed',
                }
              : undefined,
        },
        parentEventId: undefined,
      },
      childEvents: tcEvents.slice(1).map((e) => ({
        ...e,
        parentEventId: first.id,
      })),
    });
  }

  for (const e of events) {
    if (e.type !== 'subagent_update') continue;
    const data = e.data as { subagentId: string };
    groups.push({
      subagentEvent: e,
      childEvents: nativelyEmitted.get(data.subagentId) ?? [],
    });
  }

  return groups;
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
  const ms = Math.max(0, finish.getTime() - startDate.getTime());
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

export function formatTokens(count: number): string {
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return String(count);
}

function formatShortPath(fullPath?: string): string {
  if (!fullPath) return '';
  const parts = fullPath.replace(/\\/g, '/').split('/');
  if (parts.length <= 2) return fullPath;
  return parts.slice(-2).join('/');
}

export function formatToolTitlePeek(childEvents: ACPEventRow[] | null | undefined): string {
  if (!childEvents || childEvents.length === 0) return '';
  const last = childEvents[childEvents.length - 1];

  if (last.type === 'tool_call') {
    const tcData = last.data as ACPEventToolCallData;
    const toolName = tcData.name;
    const kind = tcData.kind;
    const args = tcData.arguments ?? {};
    const locations = tcData.locations ?? [];

    if (kind === 'execute') {
      const cmd = (args.CommandLine ?? args.command ?? args.cmd ?? args.input) as
        string | undefined;
      return cmd ? cmd : (tcData.title ?? toolName);
    }

    if (kind === 'edit') {
      const rawPath = (args.TargetFile ??
        args.AbsolutePath ??
        args.path ??
        args.filePath ??
        locations[0]?.path) as string | undefined;
      return rawPath ? `edit ${formatShortPath(rawPath)}` : (tcData.title ?? 'edit file');
    }

    if (kind === 'read') {
      const rawPath = (args.AbsolutePath ?? args.path ?? args.filePath ?? locations[0]?.path) as
        string | undefined;
      return rawPath ? `read ${formatShortPath(rawPath)}` : (tcData.title ?? 'read file');
    }

    if (kind === 'search' || kind === 'fetch') {
      const q = (args.Query ?? args.query ?? args.Pattern ?? args.pattern) as string | undefined;
      return q ? `rg ${q}` : (tcData.title ?? 'search');
    }

    const firstStrArg = Object.values(args).find((v): v is string => typeof v === 'string');
    return tcData.title ?? (firstStrArg ? `${toolName} ${firstStrArg}` : toolName);
  }

  return '';
}

export function formatPeek(childEvents: ACPEventRow[] | null | undefined): string {
  if (!childEvents || childEvents.length === 0) return 'Spawning…';
  const last = childEvents[childEvents.length - 1];

  if (last.type === 'tool_call') {
    const tcData = last.data as ACPEventToolCallData;
    const toolName = tcData.name;
    const kind = tcData.kind;
    const args = tcData.arguments ?? {};
    const locations = tcData.locations ?? [];

    if (kind === 'execute') {
      const cmd = (args.CommandLine ?? args.command ?? args.cmd ?? args.input) as
        string | undefined;
      return cmd ? `Running ${cmd}` : (tcData.title ?? `Execute ${toolName}`);
    }

    if (kind === 'edit') {
      const rawPath = (args.TargetFile ??
        args.AbsolutePath ??
        args.path ??
        args.filePath ??
        locations[0]?.path) as string | undefined;
      return rawPath ? `Editing ${formatShortPath(rawPath)}` : (tcData.title ?? 'Editing file');
    }

    if (kind === 'read') {
      const rawPath = (args.AbsolutePath ?? args.path ?? args.filePath ?? locations[0]?.path) as
        string | undefined;
      return rawPath ? `Reading ${formatShortPath(rawPath)}` : (tcData.title ?? 'Reading file');
    }

    if (kind === 'search' || kind === 'fetch') {
      const q = (args.Query ?? args.query ?? args.Pattern ?? args.pattern) as string | undefined;
      return q ? `Searching "${q}"` : (tcData.title ?? 'Searching');
    }

    const firstStrArg = Object.values(args).find((v): v is string => typeof v === 'string');
    const peek = tcData.title ?? (firstStrArg ? `${toolName} ${firstStrArg}` : toolName);
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

export function buildProgressDots(childEvents: ACPEventRow[] | null | undefined): DotsResult[] {
  if (!childEvents) return [];
  const tcEvents = childEvents.filter((e) => e.type === 'tool_call');
  if (tcEvents.length === 0) return [];

  const dots: DotsResult[] = tcEvents.slice(0, 8).map((e) => {
    const data = e.data as ACPEventToolCallData;
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
  return groups.toSorted((a, b) => {
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

export interface SubagentSwarmStats {
  total: number;
  running: number;
  completed: number;
  failed: number;
  totalTokens: number;
  totalTools: number;
}

export function getSubagentSwarmStats(groups: SubagentGroup[]): SubagentSwarmStats {
  let running = 0;
  let completed = 0;
  let failed = 0;
  let totalTokens = 0;
  let totalTools = 0;

  for (const g of groups) {
    const data = g.subagentEvent.data as ACPEventSubagentUpdateData;
    if (data.status === 'running' || data.status === 'spawning') {
      running++;
    } else if (data.status === 'completed') {
      completed++;
    } else if (data.status === 'failed') {
      failed++;
    }

    if (data.result?.tokensUsed) {
      totalTokens += data.result.tokensUsed;
    }

    for (const ce of g.childEvents) {
      if (ce.type === 'tool_call') {
        totalTools++;
      }
      if (ce.metadata?.completionTokens) {
        totalTokens += ce.metadata.completionTokens;
      }
    }
  }

  return {
    total: groups.length,
    running,
    completed,
    failed,
    totalTokens,
    totalTools,
  };
}

export function filterSubagentGroups(
  groups: SubagentGroup[],
  filter: SubagentFilter,
): SubagentGroup[] {
  if (filter === 'all') return groups;
  return groups.filter((g) => {
    const data = g.subagentEvent.data as ACPEventSubagentUpdateData;
    if (filter === 'running') return data.status === 'running' || data.status === 'spawning';
    if (filter === 'completed') return data.status === 'completed';
    if (filter === 'failed') return data.status === 'failed';
    return true;
  });
}
