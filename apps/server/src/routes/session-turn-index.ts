import { asc, desc, eq, sql } from 'drizzle-orm';
import { sessionEvents, sessionEventChanges, type DbClient } from '@agentctl/core/db';
import {
  extractTurnSummary,
  orderConversationEvents,
  type SessionTurnAnchor,
} from '@agentctl/shared';

interface CachedIndex {
  revision: string;
  turns: SessionTurnAnchor[];
  bytes: number;
}
const indexCaches = new WeakMap<object, Map<string, CachedIndex>>();
const MAX_INDEX_CACHE_BYTES = 8 * 1024 * 1024;
const MAX_INDEX_CACHE_SESSIONS = 32;

/** Cache bounded previews by the durable event-change cursor, including edits and rewinds. */
export function readTurnIndex(
  db: Pick<DbClient, 'select'>,
  sessionId: string,
): SessionTurnAnchor[] {
  const latestChange =
    db
      .select({ sequence: sessionEventChanges.sequence })
      .from(sessionEventChanges)
      .where(eq(sessionEventChanges.sessionId, sessionId))
      .orderBy(desc(sessionEventChanges.sequence))
      .limit(1)
      .get()?.sequence ?? 0;
  const lastEvent =
    db
      .select({ id: sessionEvents.id })
      .from(sessionEvents)
      .where(eq(sessionEvents.sessionId, sessionId))
      .orderBy(desc(sessionEvents.id))
      .limit(1)
      .get()?.id ?? 0;
  const revision = `${latestChange}:${lastEvent}`;
  let cache = indexCaches.get(db);
  if (!cache) {
    cache = new Map();
    indexCaches.set(db, cache);
  }
  const saved = cache.get(sessionId);
  if (saved?.revision === revision) {
    cache.delete(sessionId);
    cache.set(sessionId, saved);
    return saved.turns;
  }
  const turns = buildTurnIndex(db, sessionId);
  cache.delete(sessionId);
  const bytes = Buffer.byteLength(JSON.stringify(turns));
  if (bytes <= MAX_INDEX_CACHE_BYTES) cache.set(sessionId, { revision, turns, bytes });
  let totalBytes = [...cache.values()].reduce((sum, entry) => sum + entry.bytes, 0);
  while (cache.size > MAX_INDEX_CACHE_SESSIONS || totalBytes > MAX_INDEX_CACHE_BYTES) {
    const oldest = cache.keys().next().value!;
    totalBytes -= cache.get(oldest)!.bytes;
    cache.delete(oldest);
  }
  return turns;
}

function buildTurnIndex(db: Pick<DbClient, 'select'>, sessionId: string): SessionTurnAnchor[] {
  // Read bounded preview fields and ownership links, without materializing tool output,
  // patches, attachments, or full agent response bodies in the application.
  const rows = db
    .select({
      id: sessionEvents.id,
      type: sessionEvents.type,
      parentEventId: sessionEvents.parentEventId,
      createdAt: sessionEvents.createdAt,
      attemptId: sql<string | null>`json_extract(${sessionEvents.metadata}, '$.attemptId')`,
      nativeSessionId: sql<
        string | null
      >`json_extract(${sessionEvents.metadata}, '$.nativeSessionId')`,
      role: sql<string | null>`json_extract(${sessionEvents.data}, '$.role')`,
      content: sql<string>`case when ${sessionEvents.type} = 'text' then substr(coalesce(json_extract(${sessionEvents.data}, '$.content'), ''), 1, 1000) else '' end`,
      name: sql<string | null>`substr(json_extract(${sessionEvents.data}, '$.name'), 1, 200)`,
      title: sql<string | null>`substr(json_extract(${sessionEvents.data}, '$.title'), 1, 200)`,
      status: sql<string | null>`json_extract(${sessionEvents.data}, '$.status')`,
      planText: sql<
        string | null
      >`case when ${sessionEvents.type} = 'plan_update' then (select substr(coalesce(nullif(json_extract(value, '$.name'), ''), json_extract(value, '$.text')), 1, 1000) from json_each(${sessionEvents.data}, '$.plan') where coalesce(json_extract(value, '$.name'), json_extract(value, '$.text'), '') != '' limit 1) end`,
      additions: sql<
        number | null
      >`json_extract(${sessionEvents.data}, '$.turnChanges.totalAdditions')`,
      deletions: sql<
        number | null
      >`json_extract(${sessionEvents.data}, '$.turnChanges.totalDeletions')`,
      filesCount: sql<
        number | null
      >`json_array_length(json_extract(${sessionEvents.data}, '$.turnChanges.files'))`,
    })
    .from(sessionEvents)
    .where(eq(sessionEvents.sessionId, sessionId))
    .orderBy(asc(sessionEvents.id))
    .all();
  const events = rows.map((row) => ({
    ...row,
    metadata: {
      attemptId: row.attemptId ?? undefined,
      nativeSessionId: row.nativeSessionId ?? undefined,
    },
    data: {
      role: row.role,
      content: row.content,
      name: row.name,
      title: row.title,
      status: row.status,
      plan: row.planText ? [{ text: row.planText }] : [],
    },
  }));
  const turns: SessionTurnAnchor[] = [];
  let current: (typeof events)[number] | undefined;
  let output: (typeof events)[number][] = [];
  const finish = () => {
    if (!current) return;
    const stats = output.find(
      (event) =>
        event.type === 'status' &&
        event.status === 'turn_end' &&
        typeof event.additions === 'number' &&
        typeof event.deletions === 'number' &&
        typeof event.filesCount === 'number',
    );
    turns.push({
      eventId: current.id,
      prompt: current.content.trim().slice(0, 600),
      timestamp: current.createdAt.toISOString(),
      summary: extractTurnSummary(output),
      eventCount: output.length,
      diffStats: stats
        ? {
            additions: stats.additions!,
            deletions: stats.deletions!,
            filesCount: stats.filesCount ?? 0,
          }
        : undefined,
    });
  };
  for (const event of orderConversationEvents(events)) {
    if (event.type === 'text' && event.role === 'user' && !event.nativeSessionId) {
      finish();
      current = event;
      output = [];
    } else if (
      current &&
      !(
        event.type === 'status' &&
        ['available_commands_update', 'config_option_update', 'session_info_update'].includes(
          event.status ?? '',
        )
      )
    ) {
      output.push(event);
    }
  }
  finish();
  return turns;
}
