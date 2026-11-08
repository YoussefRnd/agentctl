import { and, asc, desc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import type { DbClient } from '../../db/index.js';
import {
  sessions,
  sessionEvents,
  sessionEventChanges,
  sessionProviderContexts,
  sessionTurnAttempts,
} from '../../db/schema.js';
import {
  buildConversationHistoryTranscript,
  HistoryTranscriptBudgetError,
} from '../history-transcript.js';

export class ProviderContextRecoveryError extends Error {}

type ProviderContextIdentity = Pick<
  typeof sessionProviderContexts.$inferSelect,
  'sessionId' | 'providerId' | 'nativeSessionId'
>;

function readProviderContext(
  db: DbClient,
  { sessionId, providerId, nativeSessionId }: ProviderContextIdentity,
) {
  const receipt = db
    .select()
    .from(sessionProviderContexts)
    .where(
      and(
        eq(sessionProviderContexts.sessionId, sessionId),
        eq(sessionProviderContexts.providerId, providerId),
        eq(sessionProviderContexts.nativeSessionId, nativeSessionId),
      ),
    )
    .get();
  return { receipt, deliveryUncertain: receipt?.status === 'pending' };
}

function latestSessionChange(db: DbClient, sessionId: string): number {
  return (
    db
      .select({ sequence: sessionEventChanges.sequence })
      .from(sessionEventChanges)
      .where(eq(sessionEventChanges.sessionId, sessionId))
      .orderBy(desc(sessionEventChanges.sequence))
      .limit(1)
      .get()?.sequence ?? 0
  );
}

/** A native conversation's cursor advances only after its prompt has returned. */
export class ProviderContextDelivery {
  private initialized = false;
  constructor(
    private db: DbClient,
    private identity: ProviderContextIdentity,
    private fresh: boolean,
  ) {}

  static canResume(db: DbClient, identity: ProviderContextIdentity): boolean {
    return !readProviderContext(db, identity).deliveryUncertain;
  }

  static recordNativeFork(db: DbClient, identity: ProviderContextIdentity): void {
    db.insert(sessionProviderContexts)
      .values({
        ...identity,
        throughSequence: latestSessionChange(db, identity.sessionId),
        status: 'delivered',
      })
      .onConflictDoNothing()
      .run();
  }

  get usedTokens(): number {
    return this.fresh ? 0 : (readProviderContext(this.db, this.identity).receipt?.usedTokens ?? 0);
  }

  async prepare(eventId: number | undefined, budget: number) {
    const { sessionId, providerId, nativeSessionId } = this.identity;
    if (!this.initialized) {
      if (this.fresh)
        this.db
          .delete(sessionProviderContexts)
          .where(
            and(
              eq(sessionProviderContexts.sessionId, sessionId),
              eq(sessionProviderContexts.providerId, providerId),
              eq(sessionProviderContexts.nativeSessionId, nativeSessionId),
            ),
          )
          .run();
      this.initialized = true;
    }
    const { receipt, deliveryUncertain } = readProviderContext(this.db, this.identity);
    if (deliveryUncertain)
      throw new ProviderContextRecoveryError(
        'Historical context delivery is uncertain; replace the native conversation before retrying.',
      );
    // Existing installations may have completed turns before context receipts existed.
    const legacyCursor =
      !this.fresh && !receipt
        ? this.db
            .select({ sequence: sessionEventChanges.sequence })
            .from(sessionEvents)
            .innerJoin(sessionEventChanges, eq(sessionEvents.id, sessionEventChanges.eventId))
            .innerJoin(
              sessionTurnAttempts,
              eq(
                sessionTurnAttempts.id,
                sql`json_extract(${sessionEvents.metadata}, '$.attemptId')`,
              ),
            )
            .where(
              and(
                eq(sessionEvents.sessionId, sessionId),
                eq(sessionTurnAttempts.providerId, providerId),
                eq(sessionTurnAttempts.nativeSessionId, nativeSessionId),
                eventId === undefined
                  ? isNotNull(sessionEvents.parentEventId)
                  : ne(sessionEvents.parentEventId, eventId),
                isNotNull(sessionTurnAttempts.dispatchedAt),
              ),
            )
            .orderBy(desc(sessionEventChanges.sequence))
            .limit(1)
            .get()?.sequence
        : undefined;
    const throughSequence = receipt?.throughSequence ?? legacyCursor ?? 0;
    const oldest =
      throughSequence > 0
        ? this.db
            .select({ sequence: sessionEventChanges.sequence })
            .from(sessionEventChanges)
            .where(eq(sessionEventChanges.sessionId, sessionId))
            .orderBy(asc(sessionEventChanges.sequence))
            .limit(1)
            .get()?.sequence
        : undefined;
    if (oldest !== undefined && oldest > throughSequence) {
      throw new ProviderContextRecoveryError(
        'The saved history cursor has expired; replace the native conversation before retrying.',
      );
    }
    let context: string | null;
    try {
      context = await buildConversationHistoryTranscript(this.db, sessionId, {
        afterSequence: throughSequence,
        excludeEventId: eventId,
        maxBytes: budget,
      });
    } catch (error) {
      if (!this.fresh && error instanceof HistoryTranscriptBudgetError)
        throw new ProviderContextRecoveryError(error.message, { cause: error });
      throw error;
    }
    const save = (status: 'pending' | 'delivered', cursor: number, usedTokens: number) =>
      this.db
        .insert(sessionProviderContexts)
        .values({ ...this.identity, status, throughSequence: cursor, usedTokens })
        .onConflictDoUpdate({
          target: [
            sessionProviderContexts.sessionId,
            sessionProviderContexts.providerId,
            sessionProviderContexts.nativeSessionId,
          ],
          set: { status, throughSequence: cursor, usedTokens },
        })
        .run();
    return {
      context,
      strategy: throughSequence === 0 ? 'full_thread_summary' : 'delta_since_target_last_seen',
      pending: () => save('pending', throughSequence, receipt?.usedTokens ?? 0),
      unsent: () => save('delivered', throughSequence, receipt?.usedTokens ?? 0),
      delivered: (eventId: number, inputCost: number) => {
        const usage = this.db
          .select({ used: sessions.contextUsedTokens })
          .from(sessions)
          .where(eq(sessions.id, sessionId))
          .get()?.used;
        const outputBytes = this.db
          .select({ data: sessionEvents.data })
          .from(sessionEvents)
          .where(
            and(
              eq(sessionEvents.sessionId, sessionId),
              eq(sessionEvents.parentEventId, eventId),
              inArray(sessionEvents.type, ['text', 'tool_call', 'terminal_output', 'plan_update']),
            ),
          )
          .all()
          .reduce((sum, row) => sum + Buffer.byteLength(row.data), 0);
        save(
          'delivered',
          latestSessionChange(this.db, sessionId),
          usage ?? this.usedTokens + inputCost + outputBytes,
        );
        this.fresh = false;
      },
    };
  }
}
