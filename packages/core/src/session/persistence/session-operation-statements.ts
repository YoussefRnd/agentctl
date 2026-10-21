import { and, asc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import type { DbClient } from '../../db/index.js';
import { sessions, sessionOperations, sessionTurnAttempts } from '../../db/schema.js';
import { messageEventExists } from './session-operation-reconciliation.js';

export function prepareOperationStatements(db: DbClient) {
  return {
    previous: db
      .select({
        kind: sessionOperations.kind,
        fingerprint: sessionOperations.fingerprint,
        eventId: sessionOperations.eventId,
      })
      .from(sessionOperations)
      .where(
        and(
          eq(sessionOperations.sessionId, sql.placeholder('sessionId')),
          eq(sessionOperations.commandId, sql.placeholder('commandId')),
        ),
      )
      .prepare(),
    pending: db
      .select({ id: sessionOperations.id })
      .from(sessionOperations)
      .where(
        and(
          eq(sessionOperations.sessionId, sql.placeholder('sessionId')),
          eq(sessionOperations.status, 'pending'),
        ),
      )
      .prepare(),
    byOperation: db
      .select()
      .from(sessionTurnAttempts)
      .where(eq(sessionTurnAttempts.operationId, sql.placeholder('operationId')))
      .prepare(),
    ended: db
      .select({ status: sessionTurnAttempts.status })
      .from(sessionTurnAttempts)
      .where(eq(sessionTurnAttempts.id, sql.placeholder('attemptId')))
      .prepare(),
    complete: db
      .update(sessionOperations)
      .set({
        status: sql`${sql.placeholder('status')}`,
        updatedAt: sql`${sql.param(sql.placeholder('now'), sessionOperations.updatedAt)}`,
      })
      .where(
        and(
          eq(sessionOperations.id, sql.placeholder('operationId')),
          eq(sessionOperations.status, 'running'),
        ),
      )
      .prepare(),
    finish: db
      .update(sessionTurnAttempts)
      .set({
        status: 'completed',
        endedAt: sql`${sql.param(sql.placeholder('now'), sessionTurnAttempts.endedAt)}`,
        updatedAt: sql`${sql.param(sql.placeholder('now'), sessionTurnAttempts.updatedAt)}`,
      })
      .where(
        and(
          eq(sessionTurnAttempts.id, sql.placeholder('attemptId')),
          inArray(sessionTurnAttempts.status, ['running', 'waiting']),
        ),
      )
      .prepare(),
    blocked: db
      .select({ id: sessionOperations.id })
      .from(sessionOperations)
      .where(
        and(
          eq(sessionOperations.sessionId, sql.placeholder('sessionId')),
          inArray(sessionOperations.status, ['unknown', 'running']),
          or(ne(sessionOperations.kind, 'message.send'), messageEventExists(db)),
        ),
      )
      .prepare(),
    session: db
      .select({ status: sessions.status, selectedProvider: sessions.selectedProvider })
      .from(sessions)
      .where(eq(sessions.id, sql.placeholder('sessionId')))
      .prepare(),
    next: db
      .select()
      .from(sessionOperations)
      .where(
        and(
          eq(sessionOperations.sessionId, sql.placeholder('sessionId')),
          eq(sessionOperations.kind, 'message.send'),
          eq(sessionOperations.status, 'pending'),
          messageEventExists(db),
        ),
      )
      .orderBy(asc(sessionOperations.queuePosition), asc(sessionOperations.eventId))
      .prepare(),
    accept: db
      .insert(sessionOperations)
      .values({
        id: sql.placeholder('operationId'),
        sessionId: sql.placeholder('sessionId'),
        commandId: sql.placeholder('commandId'),
        kind: 'message.send',
        fingerprint: sql.placeholder('fingerprint'),
        traceparent: sql.placeholder('traceparent'),
        payload: sql.placeholder('payload'),
        status: 'pending',
        eventId: sql.placeholder('eventId'),
        queuePosition: sql.placeholder('eventId'),
      })
      .prepare(),
    attempt: db
      .insert(sessionTurnAttempts)
      .values({
        id: sql.placeholder('attemptId'),
        sessionId: sql.placeholder('sessionId'),
        operationId: sql.placeholder('operationId'),
        providerId: sql.placeholder('providerId'),
        status: 'queued',
      })
      .prepare(),
    claim: db
      .update(sessionOperations)
      .set({
        status: 'running',
        updatedAt: sql`${sql.param(sql.placeholder('now'), sessionOperations.updatedAt)}`,
      })
      .where(
        and(
          eq(sessionOperations.id, sql.placeholder('operationId')),
          eq(sessionOperations.status, 'pending'),
        ),
      )
      .returning()
      .prepare(),
    start: db
      .update(sessionTurnAttempts)
      .set({
        status: 'running',
        startedAt: sql`${sql.param(sql.placeholder('now'), sessionTurnAttempts.startedAt)}`,
        updatedAt: sql`${sql.param(sql.placeholder('now'), sessionTurnAttempts.updatedAt)}`,
      })
      .where(eq(sessionTurnAttempts.id, sql.placeholder('attemptId')))
      .prepare(),
  };
}
