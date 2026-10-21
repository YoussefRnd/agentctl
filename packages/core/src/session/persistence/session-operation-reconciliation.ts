import { and, eq, inArray, not, exists, sql, type Placeholder, type SQL } from 'drizzle-orm';
import type { DbClient } from '../../db/index.js';
import { sessionEvents, sessionOperations, sessionTurnAttempts } from '../../db/schema.js';

export function messageEventExists(tx: Pick<DbClient, 'select'>) {
  return exists(
    tx
      .select({ id: sessionEvents.id })
      .from(sessionEvents)
      .where(
        and(
          eq(sessionEvents.id, sessionOperations.eventId),
          eq(sessionEvents.sessionId, sessionOperations.sessionId),
        ),
      ),
  );
}

/** Rewound messages are discarded work, not unresolved provider deliveries. */
export function cancelRemovedMessageOperations(
  tx: Pick<DbClient, 'select' | 'update'>,
  sessionId?: string,
): void {
  cancelRemovedAttempts(tx, removedOperations(tx, sessionId).all());
}

function removedOperations(
  tx: Pick<DbClient, 'select' | 'update'>,
  sessionId?: string | Placeholder,
  now: Date | SQL = new Date(),
) {
  return tx
    .update(sessionOperations)
    .set({ status: 'cancelled', updatedAt: now })
    .where(
      and(
        sessionId ? eq(sessionOperations.sessionId, sessionId) : undefined,
        eq(sessionOperations.kind, 'message.send'),
        inArray(sessionOperations.status, ['pending', 'running', 'unknown']),
        not(messageEventExists(tx)),
      ),
    )
    .returning({ id: sessionOperations.id });
}

function cancelRemovedAttempts(tx: Pick<DbClient, 'update'>, removed: Array<{ id: string }>): void {
  if (!removed.length) return;
  tx.update(sessionTurnAttempts)
    .set({ status: 'cancelled', endedAt: new Date() })
    .where(
      and(
        inArray(
          sessionTurnAttempts.operationId,
          removed.map((item) => item.id),
        ),
        inArray(sessionTurnAttempts.status, ['queued', 'running', 'waiting', 'unknown']),
      ),
    )
    .run();
}

/** Prepared scoped reconciliation participates in the caller's synchronous transaction. */
export function prepareMessageReconciliation(db: DbClient) {
  const statement = removedOperations(
    db,
    sql.placeholder('sessionId'),
    sql`${sql.param(sql.placeholder('now'), sessionOperations.updatedAt)}`,
  ).prepare();
  return (sessionId: string): void => {
    const removed = statement.all({ sessionId, now: new Date() });
    cancelRemovedAttempts(db, removed);
  };
}
