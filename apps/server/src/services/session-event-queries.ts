import { and, asc, eq, gt, lte, sql } from 'drizzle-orm';
import { sessionEvents, type DbClient } from '@agentctl/core/db';
import {
  EVENT_REPLAY_LIMIT,
  parseEventRow,
  readEventPage,
  readEventWindow,
  readEventReplay,
  readSessionChangeCatchUp,
} from './session-event-history.js';
import { readTurnIndex } from './session-turn-index.js';

export class SessionEventQueries {
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
  page(sessionId: string, options: Parameters<typeof readEventPage>[2]) {
    return readEventPage(this.db, sessionId, options);
  }
  window(sessionId: string, options: Parameters<typeof readEventWindow>[2]) {
    return readEventWindow(this.db, sessionId, options);
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
