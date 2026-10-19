import { eq } from 'drizzle-orm';
import type { SessionEventPayload } from '@agentctl/shared';
import type { DbClient } from '../../db/index.js';
import { sessionOperations, sessionTurnAttempts, sessionRuntimeBindings } from '../../db/schema.js';
import type { SessionEventRepository } from './session-event-repository.js';
import { cancelRemovedMessageOperations } from './session-operation-reconciliation.js';

import { prepareOperationStatements } from './session-operation-statements.js';

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
  private prepared?: ReturnType<typeof prepareOperationStatements>;

  private get statements() {
    return (this.prepared ??= prepareOperationStatements(this.db));
  }
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
    return this.db.transaction(() => {
      const accepted = this.events.insertInTransaction(
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
      this.statements.accept.run({
        operationId,
        sessionId,
        commandId,
        fingerprint,
        traceparent: traceparent ?? null,
        payload: JSON.stringify({ text, attachmentIds }),
        eventId: accepted.id,
      });
      this.statements.attempt.run({ attemptId, sessionId, operationId, providerId });
      return accepted;
    });
  }

  next(sessionId: string) {
    if (this.statements.blocked.get({ sessionId })) return undefined;
    const row = this.statements.session.get({ sessionId });
    if (!row || row.status === 'error' || ['archived', 'merged', 'discarded'].includes(row.status))
      return undefined;
    return this.statements.next.get({ sessionId });
  }

  claim(operationId: Operation['id'], sessionId: string, attemptId: string) {
    // Prepared statements share this connection and participate in the enclosing transaction.
    return this.db.transaction(
      () => {
        if (this.statements.blocked.get({ sessionId })) return undefined;
        const now = new Date();
        const claimed = this.statements.claim.get({ operationId, now });
        if (claimed) this.statements.start.run({ attemptId, now });
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
