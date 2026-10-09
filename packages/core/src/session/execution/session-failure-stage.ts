import { and, eq, inArray, sql } from 'drizzle-orm';
import type { ChatError } from '@agentctl/shared';
import type { DbClient } from '../../db/index.js';
import { sessionEvents, sessionTurnAttempts } from '../../db/schema.js';

/** A local acceptance receipt is not proof of provider acceptance. */
export function readSessionFailureStage(db: DbClient, attemptId: string): ChatError['stage'] {
  const attempt = db
    .select()
    .from(sessionTurnAttempts)
    .where(eq(sessionTurnAttempts.id, attemptId))
    .get();
  if (!attempt?.dispatchedAt) return 'prepare';
  const accepted = db
    .select({ id: sessionEvents.id })
    .from(sessionEvents)
    .where(
      and(
        eq(sessionEvents.sessionId, attempt.sessionId),
        eq(sessionEvents.type, 'status'),
        sql`json_extract(${sessionEvents.metadata}, '$.attemptId') = ${attemptId}`,
        inArray(sql`json_extract(${sessionEvents.data}, '$.status')`, [
          'prompt_accepted',
          'first_output',
        ]),
      ),
    )
    .get();
  return accepted ? 'stream' : 'dispatch';
}
