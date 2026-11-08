import { and, eq, inArray } from 'drizzle-orm';
import type { SessionEventPayload } from '@agentctl/shared';
import type { DbClient } from '../../db/index.js';
import { sessionOperations, sessionTurnAttempts, sessionRuntimeBindings } from '../../db/schema.js';
import type { SessionEventRepository } from './session-event-repository.js';
import {
  cancelRemovedMessageOperations,
  prepareMessageReconciliation,
} from './session-operation-reconciliation.js';

import { prepareOperationStatements } from './session-operation-statements.js';
import { undispatchedCancellation } from '../contracts.js';

type Operation = typeof sessionOperations.$inferSelect;
type Attempt = typeof sessionTurnAttempts.$inferSelect;
type CommittedEvent = NonNullable<ReturnType<SessionEventRepository['updateInTransaction']>>;

function finishedOperationStatus(status?: Attempt['status']) {
  switch (status) {
    case 'completed':
      return 'succeeded';
    case 'failed':
    case 'cancelled':
      return status;
  }
}

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
  private reconciliation?: ReturnType<typeof prepareMessageReconciliation>;
  private prepared?: ReturnType<typeof prepareOperationStatements>;

  private get statements() {
    return (this.prepared ??= prepareOperationStatements(this.db));
  }
  constructor(
    private db: DbClient,
    private events: SessionEventRepository,
  ) {}

  previous(sessionId: string, commandId: string) {
    return this.statements.previous.get({ sessionId, commandId });
  }
  session(sessionId: string) {
    return this.statements.session.get({ sessionId });
  }
  pending(sessionId: string) {
    return this.statements.pending.all({ sessionId });
  }
  attempt(operationId: string) {
    return this.statements.byOperation.get({ operationId });
  }
  reconcile(sessionId: string): void {
    const reconcile = (this.reconciliation ??= prepareMessageReconciliation(this.db));
    this.db.transaction(() => reconcile(sessionId));
  }
  finish(operationId: string, attemptId: string) {
    const ended = this.statements.ended.get({ attemptId });
    this.statements.complete.run({
      operationId,
      status: finishedOperationStatus(ended?.status) ?? 'succeeded',
      now: new Date(),
    });
    this.statements.finish.run({ attemptId, now: new Date() });
    return ended?.status;
  }

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
      this.statements.reopen.run({ sessionId });
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

  cancelRunningInput(sessionId: string): CommittedEvent[] {
    return this.db.transaction((tx) => {
      const now = new Date();
      const cancelled = tx
        .update(sessionTurnAttempts)
        .set({ status: 'cancelled', endedAt: now, updatedAt: now })
        .where(
          and(
            eq(sessionTurnAttempts.sessionId, sessionId),
            inArray(sessionTurnAttempts.status, ['running', 'waiting']),
            inArray(
              sessionTurnAttempts.operationId,
              tx
                .select({ id: sessionOperations.id })
                .from(sessionOperations)
                .where(
                  and(
                    eq(sessionOperations.sessionId, sessionId),
                    eq(sessionOperations.kind, 'message.send'),
                    eq(sessionOperations.status, 'running'),
                  ),
                ),
            ),
          ),
        )
        .returning({
          operationId: sessionTurnAttempts.operationId,
          dispatchedAt: sessionTurnAttempts.dispatchedAt,
        })
        .all();
      return cancelled.flatMap(({ operationId, dispatchedAt }) => {
        const operation = tx
          .update(sessionOperations)
          .set({ status: 'cancelled', updatedAt: now })
          .where(eq(sessionOperations.id, operationId))
          .returning({ eventId: sessionOperations.eventId })
          .get();
        const event =
          dispatchedAt === null ? this.cancelUndispatchedEvent(operation?.eventId) : undefined;
        return event ? [event] : [];
      });
    });
  }

  private cancelUndispatchedEvent(eventId: number | null | undefined) {
    if (eventId == null) return;
    return this.events.updateInTransaction(eventId, undispatchedCancellation, undefined, [
      'deliveryFailure',
    ]);
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
      const cancelledEvents: CommittedEvent[] = [];
      const recovered = lost.flatMap((operation) => {
        const attempt = tx
          .select()
          .from(sessionTurnAttempts)
          .where(eq(sessionTurnAttempts.operationId, operation.id))
          .get();
        const finished = finishedOperationStatus(attempt?.status);
        if (finished) {
          tx.update(sessionOperations)
            .set({ status: finished, updatedAt: new Date() })
            .where(eq(sessionOperations.id, operation.id))
            .run();
          if (finished === 'cancelled' && attempt?.dispatchedAt === null) {
            const event = this.cancelUndispatchedEvent(operation.eventId);
            if (event) cancelledEvents.push(event);
          }
          return [];
        }
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
        return [
          { operation, attempt, status: unsent ? ('pending' as const) : ('unknown' as const) },
        ];
      });
      return { recovered, cancelledEvents };
    });
  }
}
