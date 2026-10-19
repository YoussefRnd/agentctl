import { and, asc, eq, gt, gte, inArray, lt, lte, sql } from 'drizzle-orm';
import { sessionEvents, sessionEventChanges, type DbClient } from '@agentctl/core/db';
import { type SessionEventPage, type SessionEventRow } from '@agentctl/shared';

import {
  SessionEventPageReader,
  payloadBytes,
  EVENT_HISTORY_BYTE_BUDGET,
  type EventPageOptions,
} from './session-event-page-reader.js';
import { parseEventRow } from './session-event-row.js';
export { EVENT_HISTORY_BYTE_BUDGET } from './session-event-page-reader.js';
export { parseEventRow } from './session-event-row.js';

export const EVENT_REPLAY_LIMIT = 128;

export function readEventPage(
  db: Pick<DbClient, 'select'>,
  sessionId: string,
  options: EventPageOptions,
): SessionEventPage {
  return new SessionEventPageReader(db).read(sessionId, options);
}

/** Read forward from a targeted turn instead of walking every preceding page. */
export function readEventWindow(
  db: Pick<DbClient, 'select'>,
  sessionId: string,
  options: { aroundId?: number; afterId?: number; limit: number },
): SessionEventPage | undefined {
  const start = options.aroundId ?? options.afterId;
  if (start === undefined) return undefined;
  if (options.aroundId !== undefined) {
    const target = db
      .select({ id: sessionEvents.id })
      .from(sessionEvents)
      .where(and(eq(sessionEvents.sessionId, sessionId), eq(sessionEvents.id, start)))
      .get();
    if (!target) return undefined;
  }
  const candidates = db
    .select({ id: sessionEvents.id, payloadBytes })
    .from(sessionEvents)
    .where(
      and(
        eq(sessionEvents.sessionId, sessionId),
        options.aroundId !== undefined ? gte(sessionEvents.id, start) : gt(sessionEvents.id, start),
      ),
    )
    .orderBy(asc(sessionEvents.id))
    .limit(options.limit + 1)
    .all();
  const ids: number[] = [];
  let bytes = 0;
  for (const candidate of candidates) {
    if (
      ids.length === options.limit ||
      (ids.length > 0 && bytes + candidate.payloadBytes > EVENT_HISTORY_BYTE_BUDGET)
    )
      break;
    ids.push(candidate.id);
    bytes += candidate.payloadBytes;
  }
  if (!ids.length) return { events: [], nextBeforeId: null, nextAfterId: null };
  const rows = db
    .select()
    .from(sessionEvents)
    .where(and(eq(sessionEvents.sessionId, sessionId), inArray(sessionEvents.id, ids)))
    .orderBy(asc(sessionEvents.id))
    .all();
  const older = db
    .select({ id: sessionEvents.id })
    .from(sessionEvents)
    .where(and(eq(sessionEvents.sessionId, sessionId), lt(sessionEvents.id, ids[0])))
    .limit(1)
    .get();
  return {
    events: rows.map(parseEventRow),
    nextBeforeId: older ? ids[0] : null,
    nextAfterId: candidates.length > ids.length ? ids[ids.length - 1] : null,
  };
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
