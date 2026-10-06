import type {
  SessionEventRow,
  SessionEventToolCallData,
  SessionEventSubagentUpdateData,
} from '@agentctl/shared';

export interface SubagentGroup {
  subagentEvent: SessionEventRow;
  /** Only activity with a reported parent relationship belongs here. */
  childEvents: SessionEventRow[];
  delegationEvents?: SessionEventRow[];
  source?: 'tool' | 'reported';
  startedAt?: Date | string;
  endedAt?: Date | string;
}

export function formatSubagentTitle(name?: string): string {
  const cleaned = name?.replace(/[-_]/g, ' ').trim();
  return cleaned ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : 'Subagent';
}

function parseRecord(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Extract tool arguments from either structured arguments, stringified JSON, or rawInput. */
export function extractToolArguments(data: SessionEventToolCallData): Record<string, unknown> {
  const direct = parseRecord(data.arguments);
  if (direct) {
    if (typeof direct.arguments === 'string') {
      const nested = parseRecord(direct.arguments);
      if (nested) return nested;
    }
    if (parseRecord(direct.arguments)) {
      return direct.arguments as Record<string, unknown>;
    }
    return direct;
  }
  const raw = parseRecord(data.rawInput);
  if (raw) {
    if (typeof raw.arguments === 'string') {
      const nested = parseRecord(raw.arguments);
      if (nested) return nested;
    }
    if (parseRecord(raw.arguments)) {
      return raw.arguments as Record<string, unknown>;
    }
    const rest = { ...raw };
    delete rest.name;
    return rest;
  }
  return {};
}

/** Presentation hint only: never advertises child sessions or control capabilities. */
export function isSubagentToolCall(data: SessionEventToolCallData): boolean {
  if (data.kind === 'subagent' || data.kind === 'task') return true;
  const name = (data.name || '').toLowerCase();
  const normalizedName = name.replace(/^[a-z0-9_-]+[.:/]/, '').replace(/^(?:mcp|builtin)__/, '');
  const delegationName =
    /^(task|tasks|subagent|subagents|invoke_subagents?|start_subagents?|run_subagents?|spawn_agents?|spawn_subagents?|create_subagents?|delegate(?:_task|_agent|_to_agent)?|dispatch_(?:agents?|subagents?)|parallel_agents?|fork_(?:agents?|subagents?))$/;
  if (delegationName.test(normalizedName)) return true;
  // ACP has no canonical subagent tool kind. Some agents report kind=other
  // and put the actual operation name in the required display title.
  const title = data.title
    ?.trim()
    .toLowerCase()
    .replace(/^(?:run(?:ning)?|call(?:ing)?|exec(?:uting)?)\s+/, '')
    .replace(/[?!.]+$/, '')
    .trim();
  const normalizedTitle = title
    ? title.replace(/^[a-z0-9_-]+[.:/]/, '').replace(/^(?:mcp|builtin)__/, '')
    : '';
  if (normalizedTitle && delegationName.test(normalizedTitle)) return true;
  if (delegationTasks(data).length > 0) return true;
  const args = extractToolArguments(data);
  const hasAgentKey = [
    'subagent_type',
    'agent_type',
    'subagent',
    'agent',
    'role',
    'TypeName',
    'typeName',
    'agent_name',
    'target_agent',
  ].some((key) => typeof args[key] === 'string' && (args[key] as string).trim() !== '');
  const hasTaskKey = [
    'prompt',
    'Prompt',
    'task',
    'description',
    'instruction',
    'instructions',
    'goal',
    'message',
    'query',
    'system_prompt',
  ].some((key) => typeof args[key] === 'string' && (args[key] as string).trim() !== '');
  return hasAgentKey && hasTaskKey;
}

export function getSubagentTitleFromData(data: SessionEventToolCallData): string {
  const tasks = delegationTasks(data);
  if (tasks.length > 1) return `Delegate ${tasks.length} tasks`;
  if (data.title) return formatSubagentTitle(data.title);
  if (tasks.length === 1 && tasks[0].role) return formatSubagentTitle(tasks[0].role);
  const args = extractToolArguments(data);
  for (const key of [
    'description',
    'title',
    'role',
    'Role',
    'TypeName',
    'subagent_type',
    'agent_type',
    'agent',
    'name',
  ]) {
    if (typeof args[key] === 'string' && args[key]) return formatSubagentTitle(args[key] as string);
  }
  return formatSubagentTitle(data.name);
}

export function getSubagentScopeFromData(data: SessionEventToolCallData): string {
  const args = extractToolArguments(data);
  for (const key of [
    'prompt',
    'Prompt',
    'task',
    'description',
    'instruction',
    'instructions',
    'goal',
    'message',
    'query',
    'system_prompt',
  ]) {
    if (typeof args[key] === 'string' && (args[key] as string).trim())
      return (args[key] as string).trim();
  }
  const tasks = delegationTasks(data);
  if (tasks.length === 1) {
    return tasks[0].role ? `${tasks[0].role}: ${tasks[0].prompt}` : tasks[0].prompt;
  }
  if (tasks.length > 1)
    return tasks
      .map((task, index) => `${index + 1}. ${task.role ? `${task.role}: ` : ''}${task.prompt}`)
      .join('\n\n');
  return '';
}

/** A batch is one delegation call, not evidence of independently reported child runs. */
function delegationTasks(data: SessionEventToolCallData): { role?: string; prompt: string }[] {
  const args = extractToolArguments(data);
  let value = args.subagents ?? args.Subagents ?? args.tasks ?? args.agents;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        value = JSON.parse(trimmed);
      } catch {
        // ignore
      }
    }
  }
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry === 'string' && entry.trim()) {
      return [{ prompt: entry.trim() }];
    }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const task = entry as Record<string, unknown>;
    const prompt =
      task.prompt ??
      task.Prompt ??
      task.task ??
      task.instruction ??
      task.instructions ??
      task.goal ??
      task.message ??
      task.description;
    const role =
      task.role ??
      task.Role ??
      task.TypeName ??
      task.typeName ??
      task.agent_type ??
      task.subagent_type ??
      task.name ??
      task.title ??
      task.type;
    if (typeof prompt !== 'string' || !prompt.trim()) return [];
    return [
      {
        prompt: prompt.trim(),
        ...(typeof role === 'string' && role.trim() ? { role: role.trim() } : {}),
      },
    ];
  });
}

function mergeDefined<T extends Record<string, unknown>>(previous: T, next: T): T {
  const fields = Object.fromEntries(
    Object.entries(next).filter(
      ([key, value]) => value !== undefined && !(key === 'name' && value === ''),
    ),
  );
  return { ...previous, ...fields };
}

export function toolResultText(data: SessionEventToolCallData): string {
  const contentBlocks = data.content ?? [];
  const textBlocks: string[] = [];
  for (const block of contentBlocks) {
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;
    if (typeof b.text === 'string' && b.text) {
      textBlocks.push(b.text);
      continue;
    }
    if (b.content && typeof b.content === 'object') {
      const inner = b.content as Record<string, unknown>;
      if (typeof inner.text === 'string' && inner.text) {
        textBlocks.push(inner.text);
        continue;
      }
    }
  }
  const text = textBlocks.join('\n').trim();
  if (text) return text;
  if (typeof data.rawOutput === 'string') return data.rawOutput;
  if (data.rawOutput !== undefined && data.rawOutput !== null) {
    if (typeof data.rawOutput === 'object' && !Array.isArray(data.rawOutput)) {
      const obj = data.rawOutput as Record<string, unknown>;
      for (const key of ['result', 'output', 'summary', 'message', 'error', 'text']) {
        if (typeof obj[key] === 'string' && Object.keys(obj).length === 1) {
          return obj[key];
        }
      }
    }
    return JSON.stringify(data.rawOutput, null, 2);
  }
  return '';
}

function statusFromTool(status?: string): SessionEventSubagentUpdateData['status'] {
  switch (status) {
    case 'pending':
      return 'pending';
    case 'in_progress':
      return 'running';
    case 'completed':
    case 'failed':
    case 'cancelled':
    case 'interrupted':
      return status;
    default:
      return 'unknown';
  }
}

export function isSubagentActive(status: string): boolean {
  return ['pending', 'spawning', 'running', 'waiting'].includes(status);
}

export function getSubagentGroupKey(group: SubagentGroup): string {
  const data = group.subagentEvent.data as SessionEventSubagentUpdateData;
  return JSON.stringify([
    group.subagentEvent.sessionId,
    group.source ?? 'reported',
    data.subagentId,
  ]);
}

/** Rebuild the view from persisted events; no separate volatile lifecycle store. */
export function extractSubagentGroups(events: SessionEventRow[]): SubagentGroup[] {
  const byId = new Map(events.map((event) => [event.id, event]));
  const toolRows = new Map<string, SessionEventRow[]>();
  const reportedRows = new Map<string, SessionEventRow[]>();
  for (const event of events) {
    if (event.type === 'tool_call' && event.data.toolCallId) {
      const key = JSON.stringify([
        event.sessionId,
        event.metadata?.nativeSessionId ?? null,
        event.data.toolCallId,
      ]);
      const rows = toolRows.get(key) ?? [];
      rows.push(event);
      toolRows.set(key, rows);
    }
    if (event.type === 'subagent_update') {
      const key = JSON.stringify([event.sessionId, event.data.subagentId]);
      const rows = reportedRows.get(key) ?? [];
      rows.push(event);
      reportedRows.set(key, rows);
    }
  }

  const groups: SubagentGroup[] = [];
  const rootGroups = new Map<number, SubagentGroup>();
  const activityOwners = new Map<number, SubagentGroup>();
  for (const rows of toolRows.values()) {
    let data = { name: '' } as SessionEventToolCallData;
    for (const row of rows) data = mergeDefined(data, row.data as SessionEventToolCallData);
    if (!isSubagentToolCall(data)) continue;
    const first = rows[0];
    const last = rows[rows.length - 1];
    const status = statusFromTool(data.status);
    const result = toolResultText(data);
    const group: SubagentGroup = {
      source: 'tool',
      subagentEvent: {
        ...first,
        type: 'subagent_update',
        data: {
          subagentId: `tool-${data.toolCallId}`,
          name: getSubagentTitleFromData(data),
          scope: getSubagentScopeFromData(data),
          status,
          result: result ? { summary: result } : undefined,
        },
      },
      delegationEvents: [{ ...last, id: first.id, data, type: 'tool_call' }],
      childEvents: [],
      startedAt: first.createdAt,
      endedAt: !isSubagentActive(status) ? eventEnd(last) : undefined,
    };
    groups.push(group);
    for (const row of rows) rootGroups.set(row.id, group);
  }
  for (const rows of reportedRows.values()) {
    let data = rows[0].data as SessionEventSubagentUpdateData;
    for (const row of rows.slice(1)) {
      const next = row.data as SessionEventSubagentUpdateData;
      data = {
        ...mergeDefined(data, next),
        result: next.result ? { ...data.result, ...next.result } : data.result,
      };
    }
    const first = rows[0];
    const last = rows[rows.length - 1];
    const group: SubagentGroup = {
      source: 'reported',
      subagentEvent: { ...first, data, type: 'subagent_update' },
      childEvents: [],
      startedAt: first.createdAt,
      endedAt:
        data.status !== 'unknown' && !isSubagentActive(data.status) ? eventEnd(last) : undefined,
    };
    groups.push(group);
    for (const row of rows) rootGroups.set(row.id, group);
  }

  for (const event of events) {
    if (rootGroups.has(event.id)) continue;
    let parentId = event.parentEventId;
    const visited = new Set<number>();
    while (parentId != null && !visited.has(parentId)) {
      visited.add(parentId);
      const group = rootGroups.get(parentId);
      if (group && group.subagentEvent.sessionId === event.sessionId) {
        group.childEvents.push(event);
        activityOwners.set(event.id, group);
        break;
      }
      parentId = byId.get(parentId)?.parentEventId;
    }
  }
  // Permission requests often identify a tool without using its event as parent.
  for (const event of events) {
    if (event.type !== 'approval_request' || !event.data.toolCallId) continue;
    const key = JSON.stringify([
      event.sessionId,
      event.metadata?.nativeSessionId ?? null,
      event.data.toolCallId,
    ]);
    const rows = toolRows.get(key);
    const group = rows ? (rootGroups.get(rows[0].id) ?? activityOwners.get(rows[0].id)) : undefined;
    if (group && !group.childEvents.some((child) => child.id === event.id))
      group.childEvents.push(event);
  }
  for (const group of groups) group.childEvents.sort((a, b) => a.id - b.id);
  return sortSubagentGroups(groups);
}

function eventEnd(event: SessionEventRow): Date | string {
  const start = new Date(event.createdAt).getTime();
  const duration = event.metadata?.durationMs;
  return typeof duration === 'number' && duration >= 0
    ? new Date(start + duration)
    : event.createdAt;
}

export function sortSubagentGroups(groups: SubagentGroup[]): SubagentGroup[] {
  // Keep positions stable when one parallel task changes status.
  return groups.toSorted(
    (a, b) =>
      new Date(a.subagentEvent.createdAt).getTime() -
        new Date(b.subagentEvent.createdAt).getTime() || a.subagentEvent.id - b.subagentEvent.id,
  );
}

export function subagentApprovals(group: SubagentGroup): SessionEventRow[] {
  return group.childEvents.filter(
    (event) => event.type === 'approval_request' && event.data.status === 'pending',
  );
}

export function subagentDisplayStatus(group: SubagentGroup, isConnected = true): string {
  const status = (group.subagentEvent.data as SessionEventSubagentUpdateData).status;
  const data = group.subagentEvent.data as SessionEventSubagentUpdateData;
  if (data.historical) return 'History';
  if (subagentApprovals(group).length) return 'Needs approval';
  if (data.native && !isConnected) return 'Disconnected';
  if (data.native && status === 'idle') {
    if (data.state?.stopReason === 'cancelled') return 'Idle · Cancelled';
    if (data.state?.stopReason === 'error') return 'Idle · Error';
  }
  if (!isConnected && isSubagentActive(status)) return 'Disconnected';
  return (
    (
      {
        spawning: 'Starting',
        pending: 'Queued',
        running: 'Running',
        waiting: 'Waiting',
        completed: 'Completed',
        failed: 'Failed',
        cancelled: 'Cancelled',
        interrupted: 'Interrupted',
        unknown: 'Status unknown',
        idle: 'Idle',
      } as Record<string, string>
    )[status] ?? 'Status unknown'
  );
}

export function subagentProgress(group: SubagentGroup): string {
  const data = group.subagentEvent.data as SessionEventSubagentUpdateData;
  if (!isSubagentActive(data.status)) return data.result?.summary ?? '';
  const last = [...group.childEvents]
    .reverse()
    .find((event) => event.type === 'tool_call' || event.type === 'text');
  if (last?.type === 'text') return last.data.content;
  if (last?.type === 'tool_call') {
    const args = extractToolArguments(last.data);
    const command = args.command;
    return last.data.kind === 'execute' && typeof command === 'string'
      ? command
      : last.data.title || last.data.name;
  }
  const delegation = group.delegationEvents?.at(-1);
  return delegation?.type === 'tool_call' ? toolResultText(delegation.data) : '';
}

export function subagentResult(group: SubagentGroup): string {
  const summary = (group.subagentEvent.data as SessionEventSubagentUpdateData).result?.summary;
  if (summary) return summary;
  return [
    ...new Set(
      group.childEvents.flatMap((event) =>
        event.type === 'text' &&
        (event.data.role === 'provider' || (event.data.role as string) === 'assistant') &&
        event.data.content
          ? [event.data.content]
          : [],
      ),
    ),
  ].join('\n\n');
}

export function formatDuration(
  start: Date | string | null,
  now: Date | null,
  end: Date | string | null,
): string {
  if (!start || (!end && !now)) return '--';
  const startMs = new Date(start).getTime();
  const endMs = new Date(end ?? now!).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return '--';
  const seconds = Math.max(0, Math.floor((endMs - startMs) / 1000));
  if (seconds >= 3600)
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  if (seconds >= 60) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${seconds}s`;
}
