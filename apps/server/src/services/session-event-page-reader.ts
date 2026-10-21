import { and, asc, desc, eq, lt, lte, sql } from 'drizzle-orm';
import { sessionEvents, type DbClient, type SessionEventDbRow } from '@agentctl/core/db';
import type { SessionEventPage } from '@agentctl/shared';
import { parseEventRow } from './session-event-row.js';

export const EVENT_HISTORY_BYTE_BUDGET = 1_048_576;

// Inspect UTF-8 payload sizes before fetching/decoding bodies; allow for row fields too.
export const payloadBytes = sql<number>`length(cast(${sessionEvents.data} as blob)) + coalesce(length(cast(${sessionEvents.metadata} as blob)), 0) + 512`;

export interface EventPageOptions {
  beforeId?: number;
  throughId?: number;
  limit: number;
}
export interface CapturedEventPage {
  rows: SessionEventDbRow[];
  nextBeforeId: number | null;
  nextAfterId?: number | null;
}

type HistoryDatabase = Pick<DbClient, 'select'>;

// Only fields used by the DB/wire codecs; the separate receipt column is not history data.
const historyFields = {
  id: sessionEvents.id,
  sessionId: sessionEvents.sessionId,
  parentEventId: sessionEvents.parentEventId,
  type: sessionEvents.type,
  data: sessionEvents.data,
  metadata: sessionEvents.metadata,
  createdAt: sessionEvents.createdAt,
};

function prepareCandidates(db: HistoryDatabase, before: boolean, through: boolean) {
  return db
    .select({ id: sessionEvents.id, payloadBytes })
    .from(sessionEvents)
    .where(
      and(
        eq(sessionEvents.sessionId, sql.placeholder('sessionId')),
        before ? lt(sessionEvents.id, sql.placeholder('beforeId')) : undefined,
        through ? lte(sessionEvents.id, sql.placeholder('throughId')) : undefined,
      ),
    )
    .orderBy(desc(sessionEvents.id))
    .limit(sql.placeholder('limit'))
    .prepare();
}

function prepareRows(db: HistoryDatabase) {
  return db
    .select(historyFields)
    .from(sessionEvents)
    .where(
      and(
        eq(sessionEvents.sessionId, sql.placeholder('sessionId')),
        // A single bound JSON array preserves the exact preflight selection, including ID gaps.
        // Neither SQL construction nor statement shape depends on the page length or ID values.
        sql`${sessionEvents.id} in (select value from json_each(${sql.placeholder('ids')}))`,
      ),
    )
    .orderBy(asc(sessionEvents.id))
    .prepare();
}

function prepareParent(db: HistoryDatabase) {
  return db
    .select(historyFields)
    .from(sessionEvents)
    .where(
      and(
        eq(sessionEvents.sessionId, sql.placeholder('sessionId')),
        eq(sessionEvents.id, sql.placeholder('parentId')),
        eq(sessionEvents.type, 'text'),
        sql`json_extract(${sessionEvents.data}, '$.role') = 'user'`,
      ),
    )
    .limit(1)
    .prepare();
}

function prepareParentSize(db: HistoryDatabase) {
  return db
    .select({ payloadBytes })
    .from(sessionEvents)
    .where(
      and(
        eq(sessionEvents.sessionId, sql.placeholder('sessionId')),
        eq(sessionEvents.id, sql.placeholder('parentId')),
      ),
    )
    .limit(1)
    .prepare();
}

/** Owns a bounded set of statements on one connection; never caches event data or pages. */
export class SessionEventPageReader {
  private candidates = new Map<number, ReturnType<typeof prepareCandidates>>();
  private rows?: ReturnType<typeof prepareRows>;
  private parent?: ReturnType<typeof prepareParent>;
  private parentSize?: ReturnType<typeof prepareParentSize>;

  constructor(private readonly db: HistoryDatabase) {}

  read(sessionId: string, options: EventPageOptions): SessionEventPage {
    const { rows, ...cursors } = this.capture(sessionId, options);
    return { events: rows.map(parseEventRow), ...cursors };
  }

  // Capture rows and cursors synchronously; decoding may then yield without holding a DB view.
  capture(sessionId: string, options: EventPageOptions): CapturedEventPage {
    // Four possible cursor shapes; avoid optional-parameter ORs that weaken index range scans.
    const before = options.beforeId !== undefined;
    const through = options.throughId !== undefined;
    const key = Number(before) + 2 * Number(through);
    let statement = this.candidates.get(key);
    if (!statement) {
      statement = prepareCandidates(this.db, before, through);
      this.candidates.set(key, statement);
    }
    const candidates = statement.all({ sessionId, ...options, limit: options.limit + 1 });
    const ids: number[] = [];
    let bytes = 0;
    for (const candidate of candidates) {
      if (ids.length === options.limit) break;
      // Keep one complete oversized row so pagination can always make progress.
      if (ids.length > 0 && bytes + candidate.payloadBytes > EVENT_HISTORY_BYTE_BUDGET) break;
      ids.push(candidate.id);
      bytes += candidate.payloadBytes;
    }
    if (ids.length === 0) return { rows: [], nextBeforeId: null };
    const rows = (this.rows ??= prepareRows(this.db)).all({ sessionId, ids: JSON.stringify(ids) });
    const nextBeforeId = candidates.length > ids.length ? ids[ids.length - 1] : null;
    const parentId = rows[0]?.parentEventId;
    if (parentId && !ids.includes(parentId)) {
      const values = { sessionId, parentId };
      const size = (this.parentSize ??= prepareParentSize(this.db)).get(values);
      if (size && bytes + size.payloadBytes <= EVENT_HISTORY_BYTE_BUDGET) {
        const parent = (this.parent ??= prepareParent(this.db)).get(values);
        if (parent) rows.unshift(parent);
      }
    }
    return { rows, nextBeforeId };
  }
}
