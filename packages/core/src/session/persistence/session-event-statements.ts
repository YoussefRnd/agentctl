import { and, desc, eq, lt, sql } from 'drizzle-orm';
import type { DbClient } from '../../db/index.js';
import { sessionEventChanges, sessionEvents, sessions } from '../../db/schema.js';

/** Fixed query shapes, owned by one repository/connection; values are bound per execution. */
export function prepareEventStatements(db: DbClient, retention: number) {
  const tokenTotal = sql`MAX(0, ${sessions.totalTokens} + ${sql.placeholder('tokens')})`;
  return {
    insert: db
      .insert(sessionEvents)
      .values({
        sessionId: sql.placeholder('sessionId'),
        type: sql.placeholder('type'),
        clientMessageId: sql.placeholder('clientMessageId'),
        data: sql.placeholder('data'),
        parentEventId: sql.placeholder('parentEventId'),
        metadata: sql.placeholder('metadata'),
      })
      .returning()
      .prepare(),
    event: db
      .select()
      .from(sessionEvents)
      .where(eq(sessionEvents.id, sql.placeholder('eventId')))
      .prepare(),
    update: db
      .update(sessionEvents)
      .set({
        data: sql`${sql.placeholder('data')}`,
        metadata: sql`${sql.placeholder('metadata')}`,
      })
      .where(eq(sessionEvents.id, sql.placeholder('eventId')))
      .returning()
      .prepare(),
    change: db
      .insert(sessionEventChanges)
      .values({
        sessionId: sql.placeholder('sessionId'),
        eventId: sql.placeholder('eventId'),
      })
      .returning()
      .prepare(),
    cutoff: db
      .select({ sequence: sessionEventChanges.sequence })
      .from(sessionEventChanges)
      .where(eq(sessionEventChanges.sessionId, sql.placeholder('sessionId')))
      .orderBy(desc(sessionEventChanges.sequence))
      .offset(retention - 1)
      .limit(1)
      .prepare(),
    prune: db
      .delete(sessionEventChanges)
      .where(
        and(
          eq(sessionEventChanges.sessionId, sql.placeholder('sessionId')),
          lt(sessionEventChanges.sequence, sql.placeholder('sequence')),
        ),
      )
      .prepare(),
    tokens: db
      .update(sessions)
      .set({
        totalTokens: tokenTotal,
        updatedAt: sql`${sql.param(sql.placeholder('now'), sessions.updatedAt)}`,
      })
      .where(eq(sessions.id, sql.placeholder('sessionId')))
      .prepare(),
    textActivity: db
      .update(sessions)
      .set({
        totalTokens: tokenTotal,
        lastActivityAt: sql`${sql.param(sql.placeholder('activityAt'), sessions.lastActivityAt)}`,
        updatedAt: sql`${sql.param(sql.placeholder('now'), sessions.updatedAt)}`,
      })
      .where(eq(sessions.id, sql.placeholder('sessionId')))
      .prepare(),
  };
}
