import { and, eq, inArray, not, exists } from 'drizzle-orm';
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
  const removed = tx
    .update(sessionOperations)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(
      and(
        sessionId ? eq(sessionOperations.sessionId, sessionId) : undefined,
        eq(sessionOperations.kind, 'message.send'),
        inArray(sessionOperations.status, ['pending', 'running', 'unknown']),
        not(messageEventExists(tx)),
      ),
    )
    .returning({ id: sessionOperations.id })
    .all();
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
