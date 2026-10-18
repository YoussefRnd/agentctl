import { and, asc, eq, inArray, ne, or } from 'drizzle-orm';
import type { SessionEventPayload } from '@agentctl/shared';
import type { DbClient } from '../../db/index.js';
import {
  sessions,
  sessionOperations,
  sessionTurnAttempts,
  sessionRuntimeBindings,
} from '../../db/schema.js';
import type { SessionEventRepository } from './session-event-repository.js';
import {
  cancelRemovedMessageOperations,
  messageEventExists,
} from './session-operation-reconciliation.js';

type Operation = typeof sessionOperations.$inferSelect;
interface AcceptedMessage {
  sessionId: string;
  text: string;
  attachmentIds: string[];
  commandId: string;
  fingerprint: string;
  traceparent?: string;
  operationId: string;
  attemptId: string;
  providerId: string;
  attachments: SessionEventPayload<'text'>['attachments'];
}

/** Synchronous transactions only: no provider callbacks, filesystem work or publication. */
export class SessionOperationStore {
  constructor(
    private db: DbClient,
    private events: SessionEventRepository,
  ) {}

  accept({
    sessionId,
    text,
    attachmentIds,
    commandId,
    fingerprint,
    traceparent,
    operationId,
    attemptId,
    attachments,
    providerId,
  }: AcceptedMessage) {
    return this.db.transaction((tx) => {
      const accepted = this.events.insertInTransaction(
        tx,
        sessionId,
        'text',
        {
          role: 'user',
          content: text,
          clientMessageId: commandId,
          attachmentIds,
          attachments: attachments,
          deliveryStatus: 'queued',
        },
        null,
        { attemptId, promptTokens: Math.ceil(text.length / 4) },
      );
      tx.insert(sessionOperations)
        .values({
          id: operationId,
          sessionId,
          commandId,
          kind: 'message.send',
          fingerprint,
          traceparent,
          payload: JSON.stringify({ text, attachmentIds }),
          status: 'pending',
          eventId: accepted.id,
          queuePosition: accepted.id,
        })
        .run();
      tx.insert(sessionTurnAttempts)
        .values({
          id: attemptId,
          sessionId,
          operationId,
          providerId: providerId,
          status: 'queued',
        })
        .run();
      return accepted;
    });
  }

  next(sessionId: string) {
    if (
      this.db
        .select({ id: sessionOperations.id })
        .from(sessionOperations)
        .where(
          and(
            eq(sessionOperations.sessionId, sessionId),
            inArray(sessionOperations.status, ['unknown', 'running']),
            or(ne(sessionOperations.kind, 'message.send'), messageEventExists(this.db)),
          ),
        )
        .get()
    )
      return undefined;
    const row = this.db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
    if (!row || row.status === 'error' || ['archived', 'merged', 'discarded'].includes(row.status))
      return undefined;
    return this.db
      .select()
      .from(sessionOperations)
      .where(
        and(
          eq(sessionOperations.sessionId, sessionId),
          eq(sessionOperations.kind, 'message.send'),
          eq(sessionOperations.status, 'pending'),
          messageEventExists(this.db),
        ),
      )
      .orderBy(asc(sessionOperations.queuePosition), asc(sessionOperations.eventId))
      .get();
  }

  claim(operationId: Operation['id'], sessionId: string, attemptId: string) {
    return this.db.transaction(
      (tx) => {
        if (
          tx
            .select({ id: sessionOperations.id })
            .from(sessionOperations)
            .where(
              and(
                eq(sessionOperations.sessionId, sessionId),
                inArray(sessionOperations.status, ['running', 'unknown']),
                or(ne(sessionOperations.kind, 'message.send'), messageEventExists(tx)),
              ),
            )
            .get()
        )
          return undefined;
        const claimed = tx
          .update(sessionOperations)
          .set({ status: 'running', updatedAt: new Date() })
          .where(
            and(eq(sessionOperations.id, operationId), eq(sessionOperations.status, 'pending')),
          )
          .returning()
          .get();
        if (claimed)
          tx.update(sessionTurnAttempts)
            .set({ status: 'running', startedAt: new Date() })
            .where(eq(sessionTurnAttempts.id, attemptId))
            .run();
        return claimed;
      },
      { behavior: 'immediate' },
    );
  }
  /** Startup policy: retry only work known never to have reached provider dispatch. */
  recover() {
    return this.db.transaction((tx) => {
      cancelRemovedMessageOperations(tx);
      const lost = tx
        .select()
        .from(sessionOperations)
        .where(eq(sessionOperations.status, 'running'))
        .all();
      tx.update(sessionRuntimeBindings)
        .set({ connectionState: 'lost' })
        .where(eq(sessionRuntimeBindings.connectionState, 'connected'))
        .run();
      return lost.map((operation) => {
        const attempt = tx
          .select()
          .from(sessionTurnAttempts)
          .where(eq(sessionTurnAttempts.operationId, operation.id))
          .get();
        const unsent =
          operation.kind === 'message.send' && attempt && attempt.dispatchedAt === null;
        tx.update(sessionOperations)
          .set({
            status: unsent ? 'pending' : 'unknown',
            error: unsent ? null : 'Provider delivery is unknown after server restart',
          })
          .where(eq(sessionOperations.id, operation.id))
          .run();
        tx.update(sessionTurnAttempts)
          .set(
            unsent
              ? { status: 'queued', runtimeId: null, startedAt: null }
              : { status: 'unknown', endedAt: new Date() },
          )
          .where(eq(sessionTurnAttempts.operationId, operation.id))
          .run();
        return { operation, attempt, status: unsent ? ('pending' as const) : ('unknown' as const) };
      });
    });
  }
}
