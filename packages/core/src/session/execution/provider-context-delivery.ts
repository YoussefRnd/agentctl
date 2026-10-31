import { and, asc, desc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import type { DbClient } from '../../db/index.js';
import {
  sessions,
  sessionEvents,
  sessionEventChanges,
  sessionProviderContexts,
  sessionTurnAttempts,
} from '../../db/schema.js';
import { buildConversationHistoryTranscript } from '../history-transcript.js';

export class ProviderContextRecoveryError extends Error {}

export class ProviderContextBudgetError extends ProviderContextRecoveryError {
  constructor() {
    super(
      'The current request leaves too little room for conversation history. Shorten it or choose a larger-context model.',
    );
  }
}

export function providerContextReceipt(
  db: DbClient,
  sessionId: string,
  providerId: string,
  nativeSessionId: string,
) {
  return db
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
}

/** A native conversation's cursor advances only after its prompt has returned. */
export class ProviderContextDelivery {
  private initialized = false;
  constructor(
    private db: DbClient,
    private identity: { sessionId: string; providerId: string; nativeSessionId: string },
    private fresh: boolean,
  ) {}

  get usedTokens(): number {
    return this.fresh
      ? 0
      : (providerContextReceipt(
          this.db,
          this.identity.sessionId,
          this.identity.providerId,
          this.identity.nativeSessionId,
        )?.usedTokens ?? 0);
  }

  async prepare(eventId: number, budget: number) {
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
    const receipt = providerContextReceipt(this.db, sessionId, providerId, nativeSessionId);
    if (receipt?.status === 'pending')
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
                ne(sessionEvents.parentEventId, eventId),
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
        afterSequence: throughSequence > 0 ? throughSequence : undefined,
        excludeEventId: eventId,
        includeActivity: true,
        maxBytes: budget,
        maxTurns: Infinity,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('context budget'))
        throw new ProviderContextBudgetError();
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
      delivered: (inputCost: number) => {
        const latest = this.db
          .select({ sequence: sessionEventChanges.sequence })
          .from(sessionEventChanges)
          .where(eq(sessionEventChanges.sessionId, sessionId))
          .orderBy(desc(sessionEventChanges.sequence))
          .limit(1)
          .get();
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
          latest?.sequence ?? 0,
          usage ?? this.usedTokens + inputCost + outputBytes,
        );
        this.fresh = false;
      },
    };
  }
}
