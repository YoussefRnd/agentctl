import { and, desc, eq, asc, inArray, isNotNull, sql } from 'drizzle-orm';
import type { SessionExecution } from '@agentctl/shared';
import { sessionExecutionErrorSchema, turnTimingsSchema } from '@agentctl/shared';
import type { DbClient } from '../../db/index.js';
import { jsonCodecs } from '../../db/json-codecs.js';
import {
  sessions,
  sessionOperations,
  sessionTurnAttempts,
  sessionRuntimeBindings,
  sessionEvents,
} from '../../db/schema.js';

/** Independent state dimensions; provider subprocess lifetime is separate from a turn. */
export function readSessionExecutionState(db: DbClient, sessionId: string): SessionExecution {
  return db.transaction((tx) => {
    const session = tx.select().from(sessions).where(eq(sessions.id, sessionId)).get();
    if (!session) throw new Error('Session not found');
    const attemptQuery = () =>
      tx
        .select({ attempt: sessionTurnAttempts })
        .from(sessionTurnAttempts)
        .innerJoin(sessionOperations, eq(sessionOperations.id, sessionTurnAttempts.operationId))
        .innerJoin(
          sessionEvents,
          and(
            eq(sessionEvents.id, sessionOperations.eventId),
            eq(sessionEvents.sessionId, sessionTurnAttempts.sessionId),
          ),
        );
    const active = attemptQuery()
      .where(
        and(
          eq(sessionTurnAttempts.sessionId, sessionId),
          inArray(sessionTurnAttempts.status, ['running', 'waiting', 'unknown']),
        ),
      )
      .orderBy(desc(sessionOperations.eventId))
      .limit(1)
      .get()?.attempt;
    const previous = active
      ? undefined
      : attemptQuery()
          .where(
            and(
              eq(sessionTurnAttempts.sessionId, sessionId),
              isNotNull(sessionTurnAttempts.startedAt),
            ),
          )
          .orderBy(desc(sessionTurnAttempts.startedAt), desc(sessionOperations.queuePosition))
          .limit(1)
          .get()?.attempt;
    const queued =
      active || previous
        ? undefined
        : attemptQuery()
            .where(eq(sessionTurnAttempts.sessionId, sessionId))
            .orderBy(desc(sessionOperations.eventId))
            .limit(1)
            .get()?.attempt;
    const latest = active ?? previous ?? queued;
    const connected = tx
      .select()
      .from(sessionRuntimeBindings)
      .where(
        and(
          eq(sessionRuntimeBindings.sessionId, sessionId),
          eq(sessionRuntimeBindings.connectionState, 'connected'),
        ),
      )
      .limit(1)
      .get();
    const binding =
      connected ??
      (latest?.runtimeId
        ? tx
            .select()
            .from(sessionRuntimeBindings)
            .where(eq(sessionRuntimeBindings.id, latest.runtimeId))
            .get()
        : undefined);
    const pending = tx
      .select({ operation: sessionOperations, data: sessionEvents.data })
      .from(sessionOperations)
      .innerJoin(sessionEvents, eq(sessionEvents.id, sessionOperations.eventId))
      .where(
        and(
          eq(sessionOperations.sessionId, sessionId),
          eq(sessionOperations.kind, 'message.send'),
          inArray(sessionOperations.status, ['pending', 'unknown']),
        ),
      )
      .orderBy(asc(sessionOperations.queuePosition), asc(sessionOperations.eventId))
      .all();
    const operation = latest
      ? tx
          .select()
          .from(sessionOperations)
          .where(eq(sessionOperations.id, latest.operationId))
          .get()
      : undefined;
    let error: SessionExecution['error'] = operation?.error
      ? { message: operation.error }
      : undefined;
    let timings: SessionExecution['timings'];
    let failureEventId = 0;
    if (latest) {
      const diagnostics = tx
        .select({ id: sessionEvents.id, data: sessionEvents.data })
        .from(sessionEvents)
        .where(
          and(
            eq(sessionEvents.sessionId, sessionId),
            eq(sessionEvents.type, 'status'),
            sql`json_extract(${sessionEvents.metadata}, '$.attemptId') = ${latest.id}`,
            inArray(sql`json_extract(${sessionEvents.data}, '$.status')`, [
              'turn_started',
              'prompt_accepted',
              'first_output',
              'turn_end',
              'prompt_failed',
            ]),
          ),
        )
        .orderBy(desc(sessionEvents.id))
        .limit(5)
        .all()
        .reverse();
      for (const row of diagnostics) {
        const data = jsonCodecs.unknownRecord(row.data);
        const parsedTimings = turnTimingsSchema.safeParse(data.timings);
        if (parsedTimings.success) timings = { ...timings, ...parsedTimings.data };
        const parsedError = sessionExecutionErrorSchema.safeParse(data.error);
        if (parsedError.success) {
          error = parsedError.data;
          failureEventId = row.id;
        }
      }
    }
    if (session.status === 'error') {
      const runtimeFailure = tx
        .select({
          id: sessionEvents.id,
          createdAt: sessionEvents.createdAt,
          data: sessionEvents.data,
        })
        .from(sessionEvents)
        .where(
          and(
            eq(sessionEvents.sessionId, sessionId),
            eq(sessionEvents.type, 'status'),
            sql`json_extract(${sessionEvents.data}, '$.status') = 'runtime_error'`,
            sql`coalesce(json_extract(${sessionEvents.data}, '$.diagnosticOnly'), 0) = 0`,
          ),
        )
        .orderBy(desc(sessionEvents.id))
        .get();
      if (
        runtimeFailure &&
        runtimeFailure.id > failureEventId &&
        (!latest?.startedAt || runtimeFailure.createdAt >= latest.startedAt)
      ) {
        const parsed = sessionExecutionErrorSchema.safeParse(
          jsonCodecs.unknownRecord(runtimeFailure.data).error,
        );
        if (parsed.success) error = parsed.data;
      }
    }
    return {
      connection: binding?.connectionState ?? 'disconnected',
      execution: latest?.status ?? 'idle',
      attention: pending.some(({ operation }) => operation.status === 'unknown')
        ? 'delivery_uncertain'
        : session.status === 'needs_attention'
          ? 'approval'
          : session.status === 'error'
            ? 'error'
            : 'none',
      attemptId: latest?.id,
      runtimeId: binding?.id ?? latest?.runtimeId ?? undefined,
      ...(operation?.eventId != null ? { eventId: operation.eventId } : {}),
      ...(error ? { error } : {}),
      ...(timings ? { timings } : {}),
      queue: pending.map(({ operation, data }) => {
        const message = JSON.parse(data) as { content: string; attachmentIds?: string[] };
        return {
          id: operation.commandId,
          eventId: operation.eventId!,
          text: message.content,
          attachmentIds: message.attachmentIds ?? [],
          status: operation.status === 'unknown' ? 'unknown' : 'queued',
        };
      }),
    };
  });
}
