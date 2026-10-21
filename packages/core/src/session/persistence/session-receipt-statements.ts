import { and, eq, sql } from 'drizzle-orm';
import type { DbClient } from '../../db/index.js';
import { sessionEvents, sessionOperations } from '../../db/schema.js';

export function prepareReceiptStatements(db: DbClient) {
  return {
    receipt: db
      .select({ id: sessionEvents.id, data: sessionEvents.data })
      .from(sessionEvents)
      .where(
        and(
          eq(sessionEvents.sessionId, sql.placeholder('sessionId')),
          eq(sessionEvents.type, 'text'),
          eq(sessionEvents.clientMessageId, sql.placeholder('commandId')),
        ),
      )
      .limit(1)
      .prepare(),
    operation: db
      .select({ kind: sessionOperations.kind, fingerprint: sessionOperations.fingerprint })
      .from(sessionOperations)
      .where(
        and(
          eq(sessionOperations.sessionId, sql.placeholder('sessionId')),
          eq(sessionOperations.commandId, sql.placeholder('commandId')),
        ),
      )
      .limit(1)
      .prepare(),
  };
}
