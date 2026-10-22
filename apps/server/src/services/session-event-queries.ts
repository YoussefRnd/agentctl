import { and, asc, eq, gt, lte, sql } from 'drizzle-orm';
import { sessionEvents, type DbClient } from '@agentctl/core/db';
import {
  EVENT_REPLAY_LIMIT,
  parseEventRow,
  readEventWindow,
  readEventReplay,
  readSessionChangeCatchUp,
  captureEventWindow,
} from './session-event-history.js';
import { SessionEventPageReader, type EventPageOptions } from './session-event-page-reader.js';
import { prepareEventPageResponse } from './session-event-page-response.js';
import { SessionHistoryWorkQueue } from './session-history-work-queue.js';
import { readTurnIndex } from './session-turn-index.js';
import { eventDetailRevision, SessionEventProjection } from './session-event-projection.js';

export class SessionEventQueries {
  private readonly projection = new SessionEventProjection();
  compact = this.projection.compact;
  private pageReader?: SessionEventPageReader;
  private readonly historyWork = new SessionHistoryWorkQueue();
  private detailStatement?: ReturnType<SessionEventQueries['prepareDetail']>;
  constructor(private readonly db: DbClient) {}
  async list(sessionId: string) {
    const rows = await this.db
      .select()
      .from(sessionEvents)
      .where(eq(sessionEvents.sessionId, sessionId))
      .orderBy(asc(sessionEvents.id));
    return rows.map(parseEventRow);
  }
  turns(sessionId: string) {
    return readTurnIndex(this.db, sessionId);
  }
  page(sessionId: string, options: EventPageOptions) {
    return (this.pageReader ??= new SessionEventPageReader(this.db)).read(sessionId, options);
  }
  window(sessionId: string, options: Parameters<typeof readEventWindow>[2]) {
    return readEventWindow(this.db, sessionId, options);
  }
  pageResponse(
    sessionId: string,
    options: {
      beforeId?: number;
      aroundId?: number;
      afterId?: number;
      limit: number;
      compact?: boolean;
    },
    signal?: AbortSignal,
  ) {
    return this.historyWork.run(
      prepareEventPageResponse(
        () =>
          options.aroundId !== undefined || options.afterId !== undefined
            ? captureEventWindow(this.db, sessionId, options)
            : (this.pageReader ??= new SessionEventPageReader(this.db)).capture(sessionId, options),
        options.compact,
        this.compact,
      ),
      signal,
    );
  }
  private prepareDetail() {
    return this.db
      .select()
      .from(sessionEvents)
      .where(
        and(
          eq(sessionEvents.sessionId, sql.placeholder('sessionId')),
          eq(sessionEvents.id, sql.placeholder('eventId')),
        ),
      )
      .limit(1)
      .prepare();
  }
  detailResponse(sessionId: string, eventId: number, signal?: AbortSignal) {
    const capture = () =>
      (this.detailStatement ??= this.prepareDetail()).get({ sessionId, eventId });
    return this.historyWork.run(
      (function* () {
        const row = capture();
        if (!row) return undefined;
        yield;
        const event = parseEventRow(row);
        return JSON.stringify({ event, revision: eventDetailRevision(event) });
      })(),
      signal,
    );
  }
  replay(sessionId: string, afterId: number, throughId: number) {
    return readEventReplay(this.db, sessionId, afterId, throughId);
  }
  changes(sessionId: string, afterSequence?: number) {
    return readSessionChangeCatchUp(this.db, sessionId, afterSequence);
  }
  async highWater(sessionId: string) {
    const [{ id }] = await this.db
      .select({ id: sql<number>`coalesce(max(${sessionEvents.id}), 0)` })
      .from(sessionEvents)
      .where(eq(sessionEvents.sessionId, sessionId));
    return id;
  }
  async batch(sessionId: string, afterId: number, throughId: number) {
    return await this.db
      .select()
      .from(sessionEvents)
      .where(
        and(
          eq(sessionEvents.sessionId, sessionId),
          gt(sessionEvents.id, afterId),
          lte(sessionEvents.id, throughId),
        ),
      )
      .orderBy(asc(sessionEvents.id))
      .limit(EVENT_REPLAY_LIMIT);
  }
}
