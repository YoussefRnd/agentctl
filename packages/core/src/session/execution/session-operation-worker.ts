import { randomUUID, createHash } from 'node:crypto';
import { and, asc, eq, inArray, or, ne } from 'drizzle-orm';
import { z } from 'zod';
import { AgentError } from '../../agent/errors.js';
import { normalizeChatError } from '../../agent/chat-error.js';
import { readSessionFailureStage } from './session-failure-stage.js';
import type { DbClient } from '../../db/index.js';
import {
  sessions,
  sessionOperations,
  sessionTurnAttempts,
  sessionRuntimeBindings,
} from '../../db/schema.js';
import type { Logger } from '../../logger.js';
import type { SessionEventRepository } from '../persistence/session-event-repository.js';
import { resolveMessageAttachments } from '../commands/message-attachments.js';
import { MessageAcceptanceService } from '../commands/message-acceptance-service.js';
import { SessionCommandCoordinator } from '../commands/session-command-coordinator.js';
import {
  cancelRemovedMessageOperations,
  messageEventExists,
} from './session-operation-reconciliation.js';

const messageSchema = z.object({
  text: z.string(),
  attachmentIds: z.array(z.string()).default([]),
});
export type PendingSessionMessage = z.infer<typeof messageSchema> & {
  operationId: string;
  attemptId: string;
  eventId: number;
};

/** A durable dispatch queue. Running work is never blindly repeated after process loss. */
export class SessionOperationWorker {
  private running = new Map<string, Promise<void>>();
  private accepting = true;
  private suspendedSessions = new Set<string>();
  readonly commands = new SessionCommandCoordinator();
  private acceptance: MessageAcceptanceService;

  constructor(
    private db: DbClient,
    private events: SessionEventRepository,
    private execute: (sessionId: string, message: PendingSessionMessage) => Promise<void>,
    private logger: Logger,
  ) {
    this.acceptance = new MessageAcceptanceService(db);
  }

  acceptMessage(
    sessionId: string,
    text: string,
    attachmentIds: string[] = [],
    commandId: string = randomUUID(),
  ): Promise<number> {
    return this.acceptance.accept(sessionId, text, attachmentIds, commandId, () =>
      this.commands.run(sessionId, async () => {
        if (!this.accepting) throw new Error('Server is stopping');
        if (this.suspendedSessions.has(sessionId)) throw new Error('Session is unavailable');
        if (Buffer.byteLength(text) > 1_048_576 || commandId.length > 256)
          throw new Error('Message exceeds the acceptance limit');
        const fingerprint = createHash('sha256')
          .update(JSON.stringify([text, attachmentIds]))
          .digest('hex');
        const previous = this.db
          .select()
          .from(sessionOperations)
          .where(
            and(
              eq(sessionOperations.sessionId, sessionId),
              eq(sessionOperations.commandId, commandId),
            ),
          )
          .get();
        if (previous) {
          if (previous.fingerprint !== fingerprint || previous.kind !== 'message.send')
            throw new Error('Message ID was reused with different content');
          return previous.eventId!;
        }
        const receipt = await new MessageAcceptanceService(this.db).findReceipt(
          sessionId,
          commandId,
          text,
          attachmentIds,
        );
        if (receipt !== undefined) return receipt;
        const row = this.db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
        if (!row || ['archived', 'merged', 'discarded'].includes(row.status))
          throw new Error('Session is unavailable');
        this.db.transaction((tx) => cancelRemovedMessageOperations(tx, sessionId));
        const pending = this.db
          .select({ id: sessionOperations.id })
          .from(sessionOperations)
          .where(
            and(
              eq(sessionOperations.sessionId, sessionId),
              eq(sessionOperations.status, 'pending'),
            ),
          )
          .all();
        if (pending.length >= 100) throw new Error('Session queue is full');
        const attachments = await resolveMessageAttachments(sessionId, attachmentIds);
        const operationId = randomUUID();
        const attemptId = randomUUID();
        const event = this.db.transaction((tx) => {
          const accepted = this.events.insertInTransaction(
            tx,
            sessionId,
            'text',
            {
              role: 'user',
              content: text,
              clientMessageId: commandId,
              attachmentIds,
              attachments: attachments.metadata,
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
              providerId: row.selectedProvider,
              status: 'queued',
            })
            .run();
          return accepted;
        });
        this.events.publishCommitted(event);
        this.wake(sessionId);
        return event.id;
      }),
    );
  }

  wake(sessionId: string): void {
    if (!this.accepting || this.suspendedSessions.has(sessionId) || this.running.has(sessionId))
      return;
    const work = this.drain(sessionId).catch((error: unknown) =>
      this.logger.error(error, 'Session operation worker failed'),
    );
    this.running.set(sessionId, work);
    void work
      .finally(() => {
        this.running.delete(sessionId);
        // Acceptance may have raced the worker's final empty read.
        if (this.accepting && this.next(sessionId)) this.wake(sessionId);
      })
      .catch((error: unknown) => this.logger.error(error, 'Failed to wake the accepted queue'));
  }

  private next(sessionId: string) {
    if (this.suspendedSessions.has(sessionId)) return undefined;
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

  private async drain(sessionId: string): Promise<void> {
    while (this.accepting) {
      const operation = this.next(sessionId);
      if (!operation) return;
      const attempt = this.db
        .select()
        .from(sessionTurnAttempts)
        .where(eq(sessionTurnAttempts.operationId, operation.id))
        .get();
      if (!attempt || !operation.eventId) throw new Error('Incomplete session operation');
      const claimed = this.db.transaction(
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
              and(eq(sessionOperations.id, operation.id), eq(sessionOperations.status, 'pending')),
            )
            .returning()
            .get();
          if (claimed)
            tx.update(sessionTurnAttempts)
              .set({ status: 'running', startedAt: new Date() })
              .where(eq(sessionTurnAttempts.id, attempt.id))
              .run();
          return claimed;
        },
        { behavior: 'immediate' },
      );
      if (!claimed) return;
      try {
        await this.events.update(operation.eventId, { deliveryStatus: 'accepted' });
        await this.execute(sessionId, {
          ...messageSchema.parse(JSON.parse(operation.payload)),
          operationId: operation.id,
          attemptId: attempt.id,
          eventId: operation.eventId,
        });
        const ended = this.db
          .select()
          .from(sessionTurnAttempts)
          .where(eq(sessionTurnAttempts.id, attempt.id))
          .get();
        this.db
          .update(sessionOperations)
          .set({
            status:
              ended?.status === 'cancelled'
                ? 'cancelled'
                : ended?.status === 'failed'
                  ? 'failed'
                  : 'succeeded',
          })
          .where(
            and(eq(sessionOperations.id, operation.id), eq(sessionOperations.status, 'running')),
          )
          .run();
        this.db
          .update(sessionTurnAttempts)
          .set({ status: 'completed', endedAt: new Date() })
          .where(
            and(
              eq(sessionTurnAttempts.id, attempt.id),
              inArray(sessionTurnAttempts.status, ['running', 'waiting']),
            ),
          )
          .run();
        if (ended?.status === 'failed') {
          // An accepted turn can fail without throwing (notably ACP v2 foreground errors).
          // Keep its runtime available, but do not drain more input into a failing provider.
          this.db.update(sessions).set({ status: 'error' }).where(eq(sessions.id, sessionId)).run();
          return;
        }
      } catch (error) {
        if (
          this.db
            .select()
            .from(sessionOperations)
            .where(eq(sessionOperations.id, operation.id))
            .get()?.status !== 'running'
        )
          return;
        const failure = normalizeChatError(error, {
          stage: readSessionFailureStage(this.db, attempt.id),
          providerId: attempt.providerId,
          attemptId: attempt.id,
          eventId: operation.eventId,
        });
        const message = failure.message;
        const deliveryUnknown = failure.delivery === 'unknown';
        this.db
          .update(sessionOperations)
          .set({ status: deliveryUnknown ? 'unknown' : 'failed', error: message })
          .where(
            and(eq(sessionOperations.id, operation.id), eq(sessionOperations.status, 'running')),
          )
          .run();
        this.db
          .update(sessionTurnAttempts)
          .set({ status: deliveryUnknown ? 'unknown' : 'failed', endedAt: new Date() })
          .where(
            and(
              eq(sessionTurnAttempts.id, attempt.id),
              inArray(sessionTurnAttempts.status, ['queued', 'running', 'waiting', 'interrupted']),
            ),
          )
          .run();
        await this.events.update(operation.eventId, {
          deliveryStatus:
            failure.delivery === 'accepted' ? 'accepted' : deliveryUnknown ? 'unknown' : 'failed',
          deliveryError: message,
          deliveryFailure: failure,
        });
        await this.events.append(
          sessionId,
          'status',
          { status: 'prompt_failed', message, error: failure, operationId: operation.id },
          operation.eventId,
          { attemptId: attempt.id },
        );
        this.db.update(sessions).set({ status: 'error' }).where(eq(sessions.id, sessionId)).run();
        this.logger.error(error, 'Accepted session message failed');
        return;
      }
    }
  }

  async recover(): Promise<void> {
    this.db.transaction((tx) => cancelRemovedMessageOperations(tx));
    const lost = this.db
      .select()
      .from(sessionOperations)
      .where(eq(sessionOperations.status, 'running'))
      .all();
    this.db.transaction((tx) => {
      tx.update(sessionRuntimeBindings)
        .set({ connectionState: 'lost' })
        .where(eq(sessionRuntimeBindings.connectionState, 'connected'))
        .run();
      for (const operation of lost) {
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
      }
    });
    for (const operation of lost) {
      if (!operation.eventId) continue;
      const recovered = this.db
        .select()
        .from(sessionOperations)
        .where(eq(sessionOperations.id, operation.id))
        .get();
      if (recovered?.status === 'pending')
        await this.events.update(operation.eventId, { deliveryStatus: 'queued' }, undefined, [
          'deliveryError',
          'deliveryFailure',
        ]);
      else {
        const attempt = this.attemptForOperation(operation.id);
        const failure = normalizeChatError(
          new AgentError(
            'transport_lost',
            'Interrupted by server restart. This message was not resent.',
          ),
          {
            stage: 'dispatch',
            attemptId: attempt?.id,
            providerId: attempt?.providerId,
            eventId: operation.eventId,
          },
        );
        await this.events.update(operation.eventId, {
          deliveryStatus: 'unknown',
          deliveryError: failure.message,
          deliveryFailure: failure,
        });
        await this.events.append(
          operation.sessionId,
          'status',
          {
            status: 'prompt_failed',
            message: failure.message,
            error: failure,
            operationId: operation.id,
          },
          operation.eventId,
          { attemptId: attempt?.id },
        );
      }
    }
    for (const row of this.db
      .select({ sessionId: sessionOperations.sessionId })
      .from(sessionOperations)
      .where(eq(sessionOperations.status, 'pending'))
      .all())
      this.wake(row.sessionId);
  }

  private attemptForOperation(operationId: string) {
    return this.db
      .select()
      .from(sessionTurnAttempts)
      .where(eq(sessionTurnAttempts.operationId, operationId))
      .get();
  }

  cancelPending(sessionId: string): Promise<void> {
    return this.commands.run(sessionId, () => this.cancelPendingInLane(sessionId));
  }

  private async cancelPendingInLane(sessionId: string, includeRunning = false): Promise<void> {
    const pending = this.db
      .select()
      .from(sessionOperations)
      .where(
        and(
          eq(sessionOperations.sessionId, sessionId),
          includeRunning
            ? or(
                inArray(sessionOperations.status, ['pending', 'unknown']),
                and(
                  eq(sessionOperations.kind, 'message.send'),
                  eq(sessionOperations.status, 'running'),
                ),
              )
            : inArray(sessionOperations.status, ['pending', 'unknown']),
        ),
      )
      .all();
    this.db.transaction((tx) => {
      for (const item of pending) {
        tx.update(sessionOperations)
          .set({ status: 'cancelled' })
          .where(eq(sessionOperations.id, item.id))
          .run();
        tx.update(sessionTurnAttempts)
          .set({ status: 'cancelled', endedAt: new Date() })
          .where(eq(sessionTurnAttempts.operationId, item.id))
          .run();
      }
    });
    for (const item of pending)
      if (item.eventId)
        await this.events.update(
          item.eventId,
          {
            deliveryStatus: 'cancelled',
            deliveryError: 'Queued message cancelled',
          },
          undefined,
          ['deliveryFailure'],
        );
  }

  /** Stop dispatch before retiring a workspace; keep all acceptance behind the same lane. */
  retireSession(
    sessionId: string,
    kind: 'session.archive' | 'session.delete' | 'session.finalize',
    payload: unknown,
    stopRuntime: () => Promise<void>,
    execute: () => Promise<void>,
  ): Promise<void> {
    return this.runCommand(sessionId, kind, payload, async () => {
      this.suspendedSessions.add(sessionId);
      let succeeded = false;
      try {
        await this.cancelPendingInLane(sessionId, true);
        await stopRuntime();
        await this.idle(sessionId);
        await execute();
        succeeded = true;
      } finally {
        // Delete callers remove the row after teardown; don't allow input in that window.
        if (
          kind !== 'session.delete' ||
          !succeeded ||
          !this.db
            .select({ id: sessions.id })
            .from(sessions)
            .where(eq(sessions.id, sessionId))
            .get()
        ) {
          this.suspendedSessions.delete(sessionId);
        }
      }
    });
  }

  async changeQueuedMessage(
    sessionId: string,
    commandId: string,
    action: 'cancel' | 'up' | 'down' | 'edit',
    input?: string,
  ): Promise<void> {
    await this.commands.run(sessionId, async () => {
      const pending = this.db
        .select()
        .from(sessionOperations)
        .where(
          and(
            eq(sessionOperations.sessionId, sessionId),
            eq(sessionOperations.kind, 'message.send'),
            inArray(sessionOperations.status, ['pending', 'unknown']),
          ),
        )
        .orderBy(asc(sessionOperations.queuePosition), asc(sessionOperations.eventId))
        .all();
      const index = pending.findIndex((item) => item.commandId === commandId);
      if (index < 0) throw new Error('Message is already running or is no longer queued');
      const item = pending[index];
      if (action !== 'cancel' && item.status === 'unknown')
        throw new Error('Resolve uncertain delivery before changing this message');
      if (action === 'edit') {
        const text = input?.trim();
        if (!text) throw new Error('Message cannot be empty');
        if (Buffer.byteLength(text) > 1_048_576)
          throw new Error('Message exceeds the acceptance limit');
        const payload = messageSchema.parse(JSON.parse(item.payload));
        const committed = this.db.transaction((tx) => {
          const updated = tx
            .update(sessionOperations)
            .set({ payload: JSON.stringify({ ...payload, text }), updatedAt: new Date() })
            .where(and(eq(sessionOperations.id, item.id), eq(sessionOperations.status, 'pending')))
            .returning()
            .get();
          if (!updated) throw new Error('Message is already running or is no longer queued');
          if (!item.eventId) throw new Error('Message event is missing');
          const event = this.events.updateInTransaction(
            tx,
            item.eventId,
            { content: text },
            { promptTokens: Math.ceil(text.length / 4) },
          );
          if (!event) throw new Error('Message event is missing');
          return event;
        });
        this.events.publishCommitted(committed);
      } else if (action === 'cancel') {
        this.db.transaction((tx) => {
          tx.update(sessionOperations)
            .set({ status: 'cancelled' })
            .where(eq(sessionOperations.id, item.id))
            .run();
          tx.update(sessionTurnAttempts)
            .set({ status: 'cancelled', endedAt: new Date() })
            .where(eq(sessionTurnAttempts.operationId, item.id))
            .run();
        });
        if (item.eventId)
          await this.events.update(
            item.eventId,
            {
              deliveryStatus: 'cancelled',
              deliveryError: 'Queued message cancelled',
            },
            undefined,
            ['deliveryFailure'],
          );
      } else {
        const neighbor = pending[index + (action === 'up' ? -1 : 1)];
        if (!neighbor) return;
        if (neighbor.status === 'unknown')
          throw new Error('Resolve uncertain delivery before reordering these messages');
        this.db.transaction((tx) => {
          tx.update(sessionOperations)
            .set({ queuePosition: neighbor.queuePosition })
            .where(eq(sessionOperations.id, item.id))
            .run();
          tx.update(sessionOperations)
            .set({ queuePosition: item.queuePosition })
            .where(eq(sessionOperations.id, neighbor.id))
            .run();
        });
      }
    });
    this.wake(sessionId);
  }

  async resumeQueue(sessionId: string): Promise<void> {
    await this.commands.run(sessionId, async () => {
      if (!this.accepting) throw new Error('Server is stopping');
      this.db.transaction((tx) => cancelRemovedMessageOperations(tx, sessionId));
      if (this.running.has(sessionId)) throw new Error('A turn is still running');
      if (
        this.db
          .select()
          .from(sessionOperations)
          .where(
            and(
              eq(sessionOperations.sessionId, sessionId),
              eq(sessionOperations.status, 'unknown'),
            ),
          )
          .get()
      )
        throw new Error('Resolve uncertain delivery before resuming the queue');
      const row = this.db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
      if (!row || ['archived', 'merged', 'discarded'].includes(row.status))
        throw new Error('Session is unavailable');
      if (row.status === 'error')
        this.db.update(sessions).set({ status: 'idle' }).where(eq(sessions.id, sessionId)).run();
    });
    this.wake(sessionId);
  }

  stop(): void {
    this.accepting = false;
  }
  async idle(sessionId: string): Promise<void> {
    await this.running.get(sessionId);
  }

  runCommand(
    sessionId: string,
    kind: string,
    payload: unknown,
    execute: () => Promise<void>,
    commandId: string = randomUUID(),
  ): Promise<void> {
    const command = this.commands.run(sessionId, async () => {
      if (!this.accepting) throw new Error('Server is stopping');
      const fingerprint = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
      const previous = this.db
        .select()
        .from(sessionOperations)
        .where(
          and(
            eq(sessionOperations.sessionId, sessionId),
            eq(sessionOperations.commandId, commandId),
          ),
        )
        .get();
      if (previous) {
        if (previous.kind !== kind || previous.fingerprint !== fingerprint)
          throw new Error('Command ID was reused with different content');
        if (previous.status === 'succeeded') return;
        throw new Error(previous.error ?? 'Command execution has not completed');
      }
      if (
        this.running.has(sessionId) &&
        ![
          'approval.respond',
          'turn.cancel',
          'session.approval_policy',
          'session.archive',
          'session.delete',
          'session.finalize',
        ].includes(kind)
      )
        throw new Error('Finish or stop the active turn before changing the session');
      const id = randomUUID();
      this.db
        .insert(sessionOperations)
        .values({
          id,
          sessionId,
          commandId,
          kind,
          fingerprint,
          payload: JSON.stringify(payload),
          status: 'running',
        })
        .run();
      try {
        await execute();
        this.db
          .update(sessionOperations)
          .set({ status: 'succeeded' })
          .where(eq(sessionOperations.id, id))
          .run();
      } catch (error) {
        this.db
          .update(sessionOperations)
          .set({
            status: 'failed',
            error: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
          })
          .where(eq(sessionOperations.id, id))
          .run();
        throw error;
      }
    });
    return command.finally(() => this.wake(sessionId));
  }
}
