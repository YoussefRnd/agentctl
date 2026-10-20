import { and, eq, sql } from 'drizzle-orm';
import type { DbClient } from '../../db/index.js';
import {
  sessionEventChangeCounts,
  sessionEventChanges,
  sessionEvents,
  sessions,
} from '../../db/schema.js';

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
    prune: db
      .delete(sessionEventChanges)
      .where(
        and(
          eq(sessionEventChanges.sessionId, sql.placeholder('sessionId')),
          // LIMIT 0 reads no journal entries below the cap; normal overflow selects one
          // oldest entry via the session/sequence index, never walks the retention window.
          sql`${sessionEventChanges.sequence} in (
            select sequence from session_event_changes
            where session_id = ${sql.placeholder('sessionId')}
            order by sequence asc
            limit (select max(0, ${sessionEventChangeCounts.retainedCount} - ${retention})
              from ${sessionEventChangeCounts}
              where ${sessionEventChangeCounts.sessionId} = ${sql.placeholder('sessionId')})
          )`,
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
