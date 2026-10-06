import { and, asc, desc, eq, gt, inArray, lt, lte, sql } from 'drizzle-orm';
import {
  sessionEvents,
  sessionEventChanges,
  sessionEventDbRowSchema,
  type DbClient,
} from '@agentctl/core/db';
import {
  sessionEventRowSchema,
  type SessionEventPage,
  type SessionEventRow,
} from '@agentctl/shared';

export const EVENT_HISTORY_BYTE_BUDGET = 1_048_576;
export const EVENT_REPLAY_LIMIT = 128;

export function parseEventRow(raw: typeof sessionEvents.$inferSelect): SessionEventRow {
  const row = sessionEventDbRowSchema.parse(raw);
  return sessionEventRowSchema.parse({
    ...row,
    data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data,
    metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : undefined,
  });
}

// Inspect payload sizes before fetching/decoding bodies. The allowance covers row fields.
const payloadBytes = sql<number>`length(cast(${sessionEvents.data} as blob)) + coalesce(length(cast(${sessionEvents.metadata} as blob)), 0) + 512`;

export function readEventPage(
  db: Pick<DbClient, 'select'>,
  sessionId: string,
  options: { beforeId?: number; throughId?: number; limit: number },
): SessionEventPage {
  const candidates = db
    .select({ id: sessionEvents.id, payloadBytes })
    .from(sessionEvents)
    .where(
      and(
        eq(sessionEvents.sessionId, sessionId),
        options.beforeId !== undefined ? lt(sessionEvents.id, options.beforeId) : undefined,
        options.throughId !== undefined ? lte(sessionEvents.id, options.throughId) : undefined,
      ),
    )
    .orderBy(desc(sessionEvents.id))
    .limit(options.limit + 1)
    .all();
  const ids: number[] = [];
  let bytes = 0;
  for (const candidate of candidates) {
    if (ids.length === options.limit) break;
    // Keep at least one complete row so even an oversized item can be paginated.
    if (ids.length > 0 && bytes + candidate.payloadBytes > EVENT_HISTORY_BYTE_BUDGET) break;
    ids.push(candidate.id);
    bytes += candidate.payloadBytes;
  }
  if (ids.length === 0) return { events: [], nextBeforeId: null };
  const rows = db
    .select()
    .from(sessionEvents)
    .where(and(eq(sessionEvents.sessionId, sessionId), inArray(sessionEvents.id, ids)))
    .orderBy(asc(sessionEvents.id))
    .all();
  const page = rows.map(parseEventRow);
  // IDs follow the selected window, not an optional earlier turn anchor.
  const nextBeforeId = candidates.length > ids.length ? ids[ids.length - 1] : null;
  const parentId = rows[0]?.parentEventId;
  if (parentId && !ids.includes(parentId)) {
    const [parentSize] = db
      .select({ payloadBytes })
      .from(sessionEvents)
      .where(and(eq(sessionEvents.sessionId, sessionId), eq(sessionEvents.id, parentId)))
      .limit(1)
      .all();
    if (parentSize && bytes + parentSize.payloadBytes <= EVENT_HISTORY_BYTE_BUDGET) {
      const [parent] = db
        .select()
        .from(sessionEvents)
        .where(
          and(
            eq(sessionEvents.sessionId, sessionId),
            eq(sessionEvents.id, parentId),
            eq(sessionEvents.type, 'text'),
            sql`json_extract(${sessionEvents.data}, '$.role') = 'user'`,
          ),
        )
        .limit(1)
        .all();
      if (parent) page.unshift(parseEventRow(parent));
    }
  }
  return { events: page, nextBeforeId };
}

/** A small replay or a snapshot decision, made without reading large payload bodies. */
export function readEventReplay(
  db: Pick<DbClient, 'select'>,
  sessionId: string,
  afterId: number,
  throughId: number,
): SessionEventRow[] | null {
  if (afterId > throughId) return null;
  const candidates = db
    .select({ id: sessionEvents.id, payloadBytes })
    .from(sessionEvents)
    .where(
      and(
        eq(sessionEvents.sessionId, sessionId),
        gt(sessionEvents.id, afterId),
        lte(sessionEvents.id, throughId),
      ),
    )
    .orderBy(asc(sessionEvents.id))
    .limit(EVENT_REPLAY_LIMIT + 1)
    .all();
  if (
    candidates.length > EVENT_REPLAY_LIMIT ||
    candidates.reduce((total, row) => total + row.payloadBytes, 0) > EVENT_HISTORY_BYTE_BUDGET
  )
    return null;
  if (candidates.length === 0) return [];
  const rows = db
    .select()
    .from(sessionEvents)
    .where(
      and(
        eq(sessionEvents.sessionId, sessionId),
        inArray(
          sessionEvents.id,
          candidates.map((row) => row.id),
        ),
      ),
    )
    .orderBy(asc(sessionEvents.id))
    .all();
  const events = rows.map(parseEventRow);
  return Buffer.byteLength(JSON.stringify(events)) <= EVENT_HISTORY_BYTE_BUDGET ? events : null;
}

/** Read the snapshot and its cursor from one database view. Older row updates remain replayable. */
export function readSessionChangeCatchUp(db: DbClient, sessionId: string, afterSequence?: number) {
  return db.transaction((tx) => {
    const bounds = tx
      .select({
        latest: sql<number>`coalesce(max(${sessionEventChanges.sequence}), 0)`,
        oldest: sql<number>`coalesce(min(${sessionEventChanges.sequence}), 0)`,
      })
      .from(sessionEventChanges)
      .where(eq(sessionEventChanges.sessionId, sessionId))
      .get()!;
    const snapshot = () => {
      const highWaterId = tx
        .select({ value: sql<number>`coalesce(max(${sessionEvents.id}), 0)` })
        .from(sessionEvents)
        .where(eq(sessionEvents.sessionId, sessionId))
        .get()!.value;
      return {
        snapshot: {
          ...readEventPage(tx, sessionId, { limit: 200, throughId: highWaterId }),
          highWaterId,
          changeSequence: bounds.latest,
        },
        events: [] as SessionEventRow[],
      };
    };
    if (
      afterSequence === undefined ||
      !Number.isSafeInteger(afterSequence) ||
      afterSequence < 0 ||
      afterSequence > bounds.latest ||
      (bounds.oldest > 0 && afterSequence < bounds.oldest - 1)
    )
      return snapshot();
    const candidates = tx
      .select({ sequence: sessionEventChanges.sequence, id: sessionEvents.id, payloadBytes })
      .from(sessionEventChanges)
      .leftJoin(sessionEvents, eq(sessionEventChanges.eventId, sessionEvents.id))
      .where(
        and(
          eq(sessionEventChanges.sessionId, sessionId),
          gt(sessionEventChanges.sequence, afterSequence),
          lte(sessionEventChanges.sequence, bounds.latest),
        ),
      )
      .orderBy(asc(sessionEventChanges.sequence))
      .limit(EVENT_REPLAY_LIMIT + 1)
      .all();
    if (
      candidates.length > EVENT_REPLAY_LIMIT ||
      candidates.some((row) => row.id === null) ||
      candidates.reduce((sum, row) => sum + (row.payloadBytes ?? 0), 0) > EVENT_HISTORY_BYTE_BUDGET
    )
      return snapshot();
    const rows = tx
      .select({ event: sessionEvents, sequence: sessionEventChanges.sequence })
      .from(sessionEventChanges)
      .innerJoin(sessionEvents, eq(sessionEventChanges.eventId, sessionEvents.id))
      .where(
        and(
          eq(sessionEventChanges.sessionId, sessionId),
          gt(sessionEventChanges.sequence, afterSequence),
          lte(sessionEventChanges.sequence, bounds.latest),
        ),
      )
      .orderBy(asc(sessionEventChanges.sequence))
      .all();
    return {
      snapshot: undefined,
      events: rows.map((row) => ({ ...parseEventRow(row.event), sequence: row.sequence })),
    };
  });
}
