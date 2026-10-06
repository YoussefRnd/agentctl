import type { SessionEventRow } from '@agentctl/shared';

/** Queued inputs precede output in storage. Keep output with its owning input. */
export function orderConversationEvents(events: SessionEventRow[]): SessionEventRow[] {
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
  const owner = (event: SessionEventRow): number | undefined => {
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
  const unowned: SessionEventRow[] = [];
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
