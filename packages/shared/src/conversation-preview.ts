export interface ConversationPreviewEvent {
  id: number;
  type: string;
  data: Record<string, unknown>;
  parentEventId?: number | null;
  metadata?: { attemptId?: string; nativeSessionId?: string };
}

/** Pending input belongs to the composer, not to the conversation timeline. */
export function isComposerOnlyInput(event: ConversationPreviewEvent): boolean {
  return (
    event.type === 'text' &&
    event.data.role === 'user' &&
    !event.metadata?.nativeSessionId &&
    (event.data.deliveryStatus === 'queued' ||
      event.data.deliveryStatus === 'cancelled' ||
      (event.id < 0 && event.data.deliveryStatus === 'failed'))
  );
}

/** Queued inputs precede output in storage. Keep output with its owning input. */
export function orderConversationEvents<T extends ConversationPreviewEvent>(events: T[]): T[] {
  const byId = new Map(events.map((event) => [event.id, event]));
  const users = events.filter(
    (event) =>
      event.type === 'text' && event.data.role === 'user' && !event.metadata?.nativeSessionId,
  );
  const userIds = new Set(users.map((event) => event.id));
  const attempts = new Map(
    users.flatMap((event) =>
      typeof event.metadata?.attemptId === 'string'
        ? [[event.metadata.attemptId, event.id] as const]
        : [],
    ),
  );
  const owners = new Map<number, number>();
  const owner = (event: T): number | undefined => {
    const attempt =
      typeof event.metadata?.attemptId === 'string'
        ? attempts.get(event.metadata.attemptId)
        : undefined;
    if (attempt !== undefined) return attempt;
    const visited = new Set<number>();
    let parent = event.parentEventId;
    while (parent != null && !visited.has(parent)) {
      if (userIds.has(parent)) return parent;
      if (owners.has(parent)) return owners.get(parent);
      visited.add(parent);
      parent = byId.get(parent)?.parentEventId;
    }
    return undefined;
  };
  const buckets = new Map(users.map((event) => [event.id, [event]]));
  const unowned: T[] = [];
  let legacyUser: number | undefined;
  for (const event of events) {
    if (userIds.has(event.id)) {
      legacyUser = event.id;
      owners.set(event.id, event.id);
      continue;
    }
    const correlated = typeof event.metadata?.attemptId === 'string' || event.parentEventId != null;
    const id = owner(event) ?? (correlated ? undefined : legacyUser);
    if (id !== undefined) {
      owners.set(event.id, id);
      buckets.get(id)!.push(event);
    } else unowned.push(event);
  }
  return [...unowned, ...users.flatMap((event) => buckets.get(event.id)!)];
}

/** A bounded preview shared by loaded messages and the complete turn index. */
export function extractTurnSummary(events: ConversationPreviewEvent[]): string {
  const textOf = (event: ConversationPreviewEvent) =>
    typeof event.data.content === 'string' ? event.data.content.trim() : '';
  for (const event of [...events].reverse()) {
    if (event.type === 'text' && ['provider', 'assistant'].includes(String(event.data.role))) {
      const text = textOf(event);
      if (text) return (text.split(/\n\s*\n/)[0]?.trim() ?? text).slice(0, 1000);
    }
  }
  for (const event of events) {
    if (event.type !== 'plan_update' || !Array.isArray(event.data.plan)) continue;
    for (const step of event.data.plan) {
      if (typeof step !== 'object' || !step) continue;
      const record = step as Record<string, unknown>;
      const text = record.name || record.text;
      if (typeof text === 'string' && text) return text.slice(0, 1000);
    }
  }
  const names = events
    .filter((event) => event.type === 'tool_call')
    .map((event) => event.data.title || event.data.name)
    .filter((name): name is string => typeof name === 'string' && Boolean(name));
  const unique = [...new Set(names)];
  if (unique.length === 1) return `Executed ${unique[0]}`.slice(0, 1000);
  if (unique.length > 1)
    return `Executed ${unique.slice(0, 2).join(', ')}${unique.length > 2 ? ` and ${unique.length - 2} other actions` : ''}`.slice(
      0,
      1000,
    );
  for (const event of events) {
    if (event.type === 'text' && event.data.role === 'thought') {
      const text = textOf(event);
      if (text) return (text.split(/\n+/)[0]?.trim() ?? text).slice(0, 1000);
    }
  }
  return events.length === 0 ? 'Awaiting agent response...' : 'No response generated';
}
