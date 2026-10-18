import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { eq } from 'drizzle-orm';
import { createDatabase, projects, sessions, sessionEvents } from '../../db/index.js';
import { sessionOperations, sessionTurnAttempts, sessionRuntimeBindings } from '../../db/schema.js';
import { noopLogger } from '../../logger.js';
import { AgentError, AgentPromptRejectedError } from '../../agent/errors.js';
import { chatErrorSchema } from '@agentctl/shared';
import { SessionRuntime } from '../runtime/session-runtime.js';
import type { AgentSession } from '../../agent/types.js';
import { normalizeChatError } from '../../agent/chat-error.js';
import { MessageAcceptanceService } from '../commands/message-acceptance-service.js';
import { SessionEventRepository } from '../persistence/session-event-repository.js';
import { SessionOperationWorker, type PendingSessionMessage } from './session-operation-worker.js';
import { readSessionExecutionState } from './session-execution-state.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});

function fixture(
  execute: (sessionId: string, message: PendingSessionMessage) => Promise<void> = async () => {},
) {
  const db = createDatabase(':memory:');
  db.insert(projects).values({ id: 'p', name: 'Project', path: '/tmp/project' }).run();
  db.insert(sessions)
    .values({
      id: 's',
      projectId: 'p',
      branch: 'main',
      worktreePath: '/tmp/project',
      taskSlug: 'task',
      baseCommit: 'none',
      agent: 'provider',
      selectedProvider: 'provider',
    })
    .run();
  const events = new SessionEventRepository(db, { publish: vi.fn() });
  const dispatch = vi.fn(execute);
  const worker = new SessionOperationWorker(db, events, dispatch, noopLogger);
  cleanup.push(async () => {
    worker.stop();
    await worker.idle('s');
  });
  const operations = () => db.select().from(sessionOperations).all();
  const attempts = () => db.select().from(sessionTurnAttempts).all();
  return { db, events, dispatch, worker, operations, attempts };
}

async function pauseQueue(context: ReturnType<typeof fixture>) {
  context.db.update(sessions).set({ status: 'error' }).where(eq(sessions.id, 's')).run();
}

describe('SessionOperationWorker', () => {
  it('retires rewound operations atomically and dispatches the next send', async () => {
    const context = fixture();
    await pauseQueue(context);
    const oldEvent = await context.worker.acceptMessage('s', 'discarded prompt', [], 'old');
    await context.worker.acceptMessage('s', 'discarded follow-up', [], 'old-follow-up');
    context.db
      .update(sessionOperations)
      .set({ status: 'unknown' })
      .where(eq(sessionOperations.commandId, 'old'))
      .run();
    context.db
      .update(sessionTurnAttempts)
      .set({ status: 'unknown', dispatchedAt: new Date() })
      .where(eq(sessionTurnAttempts.operationId, context.operations()[0].id))
      .run();
    const backup = await context.events.backupAndDeleteEventsAfter('s', oldEvent);
    expect(context.operations().map((item) => item.status)).toEqual(['cancelled', 'cancelled']);
    expect(context.attempts().map((item) => item.status)).toEqual(['cancelled', 'cancelled']);
    expect(readSessionExecutionState(context.db, 's').execution).toBe('idle');
    context.db.update(sessions).set({ status: 'idle' }).where(eq(sessions.id, 's')).run();
    await context.worker.acceptMessage('s', 'send again', [], 'new');
    await context.worker.idle('s');
    expect(context.dispatch.mock.calls.map(([, message]) => message.text)).toEqual(['send again']);
    expect(readSessionExecutionState(context.db, 's')).toMatchObject({
      execution: 'completed',
      attention: 'none',
      queue: [],
    });
    await context.events.restoreEvents('s', backup);
    context.worker.wake('s');
    await context.worker.idle('s');
    expect(context.dispatch).toHaveBeenCalledOnce();
  });

  it('repairs orphaned deliveries from older rewinds during recovery without resending them', async () => {
    const context = fixture();
    await pauseQueue(context);
    const oldEvent = await context.worker.acceptMessage('s', 'orphaned prompt', [], 'orphan');
    await context.worker.acceptMessage('s', 'waiting prompt', [], 'waiting');
    await context.worker.idle('s');
    context.worker.stop();
    context.db
      .update(sessionOperations)
      .set({ status: 'unknown' })
      .where(eq(sessionOperations.commandId, 'orphan'))
      .run();
    context.db
      .update(sessionTurnAttempts)
      .set({ status: 'unknown', dispatchedAt: new Date() })
      .where(eq(sessionTurnAttempts.operationId, context.operations()[0].id))
      .run();
    context.db.delete(sessionEvents).where(eq(sessionEvents.id, oldEvent)).run();
    context.db.update(sessions).set({ status: 'idle' }).where(eq(sessions.id, 's')).run();
    const recovered = new SessionOperationWorker(
      context.db,
      context.events,
      context.dispatch,
      noopLogger,
    );
    cleanup.push(async () => {
      recovered.stop();
      await recovered.idle('s');
    });
    await recovered.recover();
    await recovered.idle('s');
    expect(context.operations()[0].status).toBe('cancelled');
    expect(context.attempts()[0].status).toBe('cancelled');
    expect(context.dispatch.mock.calls.map(([, message]) => message.text)).toEqual([
      'waiting prompt',
    ]);
    expect(readSessionExecutionState(context.db, 's')).toMatchObject({
      attention: 'none',
      queue: [],
    });
  });

  it('does not clear unresolved delivery that still belongs to retained history', async () => {
    const context = fixture();
    await pauseQueue(context);
    await context.worker.acceptMessage('s', 'retained uncertain prompt', [], 'retained');
    const removed = await context.worker.acceptMessage('s', 'removed prompt', [], 'removed');
    context.db
      .update(sessionOperations)
      .set({ status: 'unknown' })
      .where(eq(sessionOperations.commandId, 'retained'))
      .run();
    context.db
      .update(sessionTurnAttempts)
      .set({ status: 'unknown' })
      .where(eq(sessionTurnAttempts.operationId, context.operations()[0].id))
      .run();
    await context.events.backupAndDeleteEventsAfter('s', removed);
    context.db.update(sessions).set({ status: 'idle' }).where(eq(sessions.id, 's')).run();
    await context.worker.acceptMessage('s', 'new prompt', [], 'new');
    await context.worker.idle('s');
    expect(context.operations()[0].status).toBe('unknown');
    expect(readSessionExecutionState(context.db, 's').attention).toBe('delivery_uncertain');
    expect(context.dispatch).not.toHaveBeenCalled();
    await expect(context.worker.resumeQueue('s')).rejects.toThrow('Resolve uncertain delivery');
  });

  it('reconciles an old orphan when sending again without requiring a server restart', async () => {
    const context = fixture();
    await pauseQueue(context);
    const orphan = await context.worker.acceptMessage('s', 'old prompt', [], 'old');
    await context.worker.idle('s');
    context.db
      .update(sessionOperations)
      .set({ status: 'unknown' })
      .where(eq(sessionOperations.commandId, 'old'))
      .run();
    context.db
      .update(sessionTurnAttempts)
      .set({ status: 'unknown', dispatchedAt: new Date() })
      .where(eq(sessionTurnAttempts.operationId, context.operations()[0].id))
      .run();
    context.db.delete(sessionEvents).where(eq(sessionEvents.id, orphan)).run();
    context.db.update(sessions).set({ status: 'idle' }).where(eq(sessions.id, 's')).run();
    await context.worker.acceptMessage('s', 'send again', [], 'new');
    await context.worker.idle('s');
    expect(context.operations()[0].status).toBe('cancelled');
    expect(context.attempts()[0].status).toBe('cancelled');
    expect(context.dispatch.mock.calls.map(([, message]) => message.text)).toEqual(['send again']);
  });

  it('wakes an existing queue when a session command finishes resetting it to idle', async () => {
    const context = fixture();
    await pauseQueue(context);
    await context.worker.acceptMessage('s', 'waiting prompt', [], 'waiting');
    await context.worker.idle('s');
    await context.worker.runCommand('s', 'session.rewind', {}, async () => {
      context.db.update(sessions).set({ status: 'idle' }).where(eq(sessions.id, 's')).run();
    });
    await context.worker.idle('s');
    expect(context.dispatch).toHaveBeenCalledOnce();
    expect(context.operations().find((item) => item.commandId === 'waiting')?.status).toBe(
      'succeeded',
    );
  });

  it('edits a waiting message in place and dispatches the updated payload without changing its receipt', async () => {
    const gate = deferred();
    const context = fixture(async (_session, message) => {
      if (message.text === 'first') await gate.promise;
    });
    cleanup.unshift(async () => gate.resolve());
    await context.worker.acceptMessage('s', 'first', [], 'first');
    await vi.waitFor(() => expect(context.dispatch).toHaveBeenCalledOnce());
    const eventId = await context.worker.acceptMessage('s', 'original', [], 'waiting');
    const before = context.operations().find((item) => item.commandId === 'waiting')!;
    await context.worker.changeQueuedMessage('s', 'waiting', 'edit', 'updated message');
    const after = context.operations().find((item) => item.commandId === 'waiting')!;
    expect(after).toMatchObject({
      id: before.id,
      eventId,
      queuePosition: before.queuePosition,
      fingerprint: before.fingerprint,
    });
    const event = context.db
      .select()
      .from(sessionEvents)
      .where(eq(sessionEvents.id, eventId))
      .get()!;
    expect(JSON.parse(event.data)).toMatchObject({
      content: 'updated message',
      clientMessageId: 'waiting',
      attachmentIds: [],
      deliveryStatus: 'queued',
    });
    expect(await context.worker.acceptMessage('s', 'original', [], 'waiting')).toBe(eventId);
    const deliver = vi.fn();
    expect(
      await new MessageAcceptanceService(context.db).accept(
        's',
        'original',
        [],
        'waiting',
        deliver,
      ),
    ).toBe(eventId);
    expect(deliver).not.toHaveBeenCalled();
    await expect(
      new MessageAcceptanceService(context.db).accept('s', 'different', [], 'waiting', deliver),
    ).rejects.toThrow('different content');
    await expect(context.worker.changeQueuedMessage('s', 'first', 'edit', 'wrong')).rejects.toThrow(
      'already running',
    );
    gate.resolve();
    await context.worker.idle('s');
    expect(context.dispatch.mock.calls.map(([, message]) => message.text)).toEqual([
      'first',
      'updated message',
    ]);
  });

  it('rejects empty, oversized, and uncertain edits and does not reorder across uncertain delivery', async () => {
    const context = fixture();
    await pauseQueue(context);
    await context.worker.acceptMessage('s', 'first', [], 'first');
    await context.worker.acceptMessage('s', 'second', [], 'second');
    await expect(context.worker.changeQueuedMessage('s', 'first', 'edit', '  ')).rejects.toThrow(
      'empty',
    );
    await expect(
      context.worker.changeQueuedMessage('s', 'first', 'edit', 'x'.repeat(1_048_577)),
    ).rejects.toThrow('limit');
    const first = context.operations().find((item) => item.commandId === 'first')!;
    context.db
      .update(sessionOperations)
      .set({ status: 'unknown' })
      .where(eq(sessionOperations.id, first.id))
      .run();
    await expect(
      context.worker.changeQueuedMessage('s', 'first', 'edit', 'changed'),
    ).rejects.toThrow('uncertain');
    await expect(context.worker.changeQueuedMessage('s', 'second', 'up')).rejects.toThrow(
      'uncertain',
    );
    expect(context.operations()[0].payload).toContain('first');
    await context.worker.changeQueuedMessage('s', 'first', 'cancel');
    expect(context.operations()[0].status).toBe('cancelled');
  });

  it('acknowledges durable input while the provider is still running and dispatches once', async () => {
    const gate = deferred();
    const context = fixture(() => gate.promise);
    cleanup.unshift(async () => gate.resolve());
    const [first, duplicate] = await Promise.all([
      context.worker.acceptMessage('s', 'hello', [], 'message'),
      context.worker.acceptMessage('s', 'hello', [], 'message'),
    ]);
    expect(first).toBe(duplicate);
    await vi.waitFor(() => expect(context.dispatch).toHaveBeenCalledOnce());
    expect(context.operations()).toHaveLength(1);
    expect(context.attempts()).toMatchObject([{ status: 'running', providerId: 'provider' }]);
    expect(context.db.select().from(sessionEvents).all()).toHaveLength(1);
    await expect(context.worker.acceptMessage('s', 'changed', [], 'message')).rejects.toThrow(
      'different content',
    );
    gate.resolve();
    await context.worker.idle('s');
    expect(context.operations()[0].status).toBe('succeeded');
    expect(context.attempts()[0].status).toBe('completed');
    const restarted = new SessionOperationWorker(
      context.db,
      context.events,
      context.dispatch,
      noopLogger,
    );
    expect(await restarted.acceptMessage('s', 'hello', [], 'message')).toBe(first);
    expect(context.dispatch).toHaveBeenCalledOnce();
    restarted.stop();
  });

  it('runs one turn at a time and supports reordering and cancelling queued input', async () => {
    const gate = deferred();
    const context = fixture(async (_session, message) => {
      if (message.text === 'first') await gate.promise;
    });
    cleanup.unshift(async () => gate.resolve());
    await context.worker.acceptMessage('s', 'first', [], 'first');
    await vi.waitFor(() => expect(context.dispatch).toHaveBeenCalledOnce());
    await context.worker.acceptMessage('s', 'second', [], 'second');
    await context.worker.acceptMessage('s', 'third', [], 'third');
    await context.worker.acceptMessage('s', 'fourth', [], 'fourth');
    await context.worker.changeQueuedMessage('s', 'third', 'up');
    await context.worker.changeQueuedMessage('s', 'fourth', 'cancel');
    await expect(context.worker.changeQueuedMessage('s', 'first', 'cancel')).rejects.toThrow(
      'already running',
    );
    gate.resolve();
    await context.worker.idle('s');
    expect(context.dispatch.mock.calls.map(([, message]) => message.text)).toEqual([
      'first',
      'third',
      'second',
    ]);
    expect(context.operations().find((row) => row.commandId === 'fourth')?.status).toBe(
      'cancelled',
    );
  });

  it.each(['archived', 'merged', 'discarded'] as const)(
    'rejects input for a %s session',
    async (status) => {
      const context = fixture();
      context.db.update(sessions).set({ status }).where(eq(sessions.id, 's')).run();
      await expect(context.worker.acceptMessage('s', 'hello')).rejects.toThrow('unavailable');
      expect(context.operations()).toEqual([]);
    },
  );

  it('rejects input after shutdown and enforces the acceptance size limit', async () => {
    const context = fixture();
    await expect(context.worker.acceptMessage('s', 'x'.repeat(1_048_577))).rejects.toThrow('limit');
    context.worker.stop();
    await expect(context.worker.acceptMessage('s', 'hello')).rejects.toThrow('stopping');
  });

  it.each([false, true])(
    'keeps failures with dispatched=%s from being silently replayed',
    async (dispatched) => {
      let context: ReturnType<typeof fixture>;
      context = fixture(async (_session, message) => {
        if (dispatched)
          context.db
            .update(sessionTurnAttempts)
            .set({ dispatchedAt: new Date() })
            .where(eq(sessionTurnAttempts.id, message.attemptId))
            .run();
        throw new Error('provider lost');
      });
      const eventId = await context.worker.acceptMessage('s', 'hello');
      await context.worker.idle('s');
      const status = dispatched ? 'unknown' : 'failed';
      expect(context.operations()[0]).toMatchObject({
        status,
        error: 'The agent could not complete this turn.',
      });
      expect(context.attempts()[0].status).toBe(status);
      expect((await context.events.getEvent(eventId))?.data).toMatchObject({
        deliveryStatus: status,
      });
      expect(context.db.select().from(sessions).get()?.status).toBe('error');
      if (dispatched) await expect(context.worker.resumeQueue('s')).rejects.toThrow('uncertain');
      await context.worker.cancelPending('s');
      await context.worker.resumeQueue('s');
      expect(context.dispatch).toHaveBeenCalledOnce();
    },
  );

  it.each(['prompt_rejected', 'authentication_required'] as const)(
    'records %s as failed even after dispatch',
    async (kind) => {
      let context: ReturnType<typeof fixture>;
      context = fixture(async (_session, message) => {
        context.db
          .update(sessionTurnAttempts)
          .set({ dispatchedAt: new Date() })
          .where(eq(sessionTurnAttempts.id, message.attemptId))
          .run();
        throw new AgentError(kind, 'Input rejected', { delivery: 'rejected' });
      });
      const eventId = await context.worker.acceptMessage('s', 'hello');
      await context.worker.idle('s');
      expect(context.operations()[0]).toMatchObject({ status: 'failed' });
      expect(context.attempts()[0].status).toBe('failed');
      expect((await context.events.getEvent(eventId))?.data).toMatchObject({
        deliveryStatus: 'failed',
        deliveryFailure: {
          delivery: 'rejected',
          details: 'Input rejected',
          actions: expect.arrayContaining(['retry']),
        },
      });
    },
  );

  it.each([false, true])('recovers an interrupted turn with dispatched=%s', async (dispatched) => {
    const context = fixture();
    await pauseQueue(context);
    const eventId = await context.worker.acceptMessage('s', 'hello');
    context.db.update(sessionOperations).set({ status: 'running' }).run();
    context.db
      .update(sessionTurnAttempts)
      .set({ status: 'running', dispatchedAt: dispatched ? new Date() : null })
      .run();
    context.db
      .insert(sessionRuntimeBindings)
      .values({
        id: 'runtime',
        sessionId: 's',
        providerId: 'provider',
        connectionState: 'connected',
      })
      .run();
    await context.worker.recover();
    expect(context.operations()[0].status).toBe(dispatched ? 'unknown' : 'pending');
    expect(context.attempts()[0].status).toBe(dispatched ? 'unknown' : 'queued');
    expect((await context.events.getEvent(eventId))?.data).toMatchObject({
      deliveryStatus: dispatched ? 'unknown' : 'queued',
    });
    expect(context.db.select().from(sessionRuntimeBindings).get()?.connectionState).toBe('lost');
    if (dispatched) {
      await expect(context.worker.resumeQueue('s')).rejects.toThrow('uncertain');
      expect(context.dispatch).not.toHaveBeenCalled();
    } else {
      await context.worker.resumeQueue('s');
      await context.worker.idle('s');
      expect(context.dispatch).toHaveBeenCalledOnce();
    }
  });

  it('keeps commands idempotent and rejects conflicting command IDs', async () => {
    const context = fixture();
    const execute = vi.fn(async () => {});
    await context.worker.runCommand('s', 'session.reconnect', {}, execute, 'command');
    await context.worker.runCommand('s', 'session.reconnect', {}, execute, 'command');
    expect(execute).toHaveBeenCalledOnce();
    await expect(
      context.worker.runCommand('s', 'session.reconnect', { changed: true }, execute, 'command'),
    ).rejects.toThrow('different content');
    const failure = vi.fn(async () => {
      throw new Error('workspace failed');
    });
    await expect(
      context.worker.runCommand('s', 'session.workspace', {}, failure, 'failure'),
    ).rejects.toThrow('workspace failed');
    await expect(
      context.worker.runCommand('s', 'session.workspace', {}, failure, 'failure'),
    ).rejects.toThrow('workspace failed');
    expect(failure).toHaveBeenCalledOnce();
  });

  it('blocks workspace mutations during a turn while allowing permission policy changes', async () => {
    const gate = deferred();
    const context = fixture(() => gate.promise);
    cleanup.unshift(async () => gate.resolve());
    await context.worker.acceptMessage('s', 'hello');
    await vi.waitFor(() => expect(context.dispatch).toHaveBeenCalledOnce());
    const execute = vi.fn(async () => {});
    await expect(context.worker.runCommand('s', 'session.workspace', {}, execute)).rejects.toThrow(
      'active turn',
    );
    await context.worker.runCommand('s', 'session.approval_policy', {}, execute);
    expect(execute).toHaveBeenCalledOnce();
  });

  it.each(['session.archive', 'session.delete', 'session.finalize'] as const)(
    '%s stops active work and cancels queued input before workspace mutation',
    async (kind) => {
      const gate = deferred();
      const context = fixture(() => gate.promise);
      cleanup.unshift(async () => gate.resolve());
      await context.worker.acceptMessage('s', 'active', [], 'active');
      await vi.waitFor(() => expect(context.dispatch).toHaveBeenCalledOnce());
      const pendingId = await context.worker.acceptMessage('s', 'pending', [], 'pending');
      const stopRuntime = vi.fn(async () => gate.resolve());
      const mutate = vi.fn(async () => {
        expect(stopRuntime).toHaveBeenCalledOnce();
        expect(
          context
            .operations()
            .filter((row) => row.kind === 'message.send')
            .map((row) => row.status),
        ).toEqual(['cancelled', 'cancelled']);
        expect(context.attempts().map((row) => row.status)).toEqual(['cancelled', 'cancelled']);
        expect(context.operations().find((row) => row.kind === kind)?.status).toBe('running');
        if (kind === 'session.delete')
          context.db.delete(sessions).where(eq(sessions.id, 's')).run();
        else
          context.db
            .update(sessions)
            .set({ status: kind === 'session.archive' ? 'archived' : 'discarded' })
            .where(eq(sessions.id, 's'))
            .run();
      });
      const retirement = context.worker.retireSession('s', kind, {}, stopRuntime, mutate);
      const racingInput = context.worker.acceptMessage('s', 'too late', [], 'racing');
      const inputRejection = expect(racingInput).rejects.toThrow('unavailable');
      await retirement;
      await inputRejection;
      expect(mutate).toHaveBeenCalledOnce();
      expect(context.dispatch).toHaveBeenCalledOnce();
      if (kind !== 'session.delete') {
        expect(context.operations().find((row) => row.kind === kind)?.status).toBe('succeeded');
        expect((await context.events.getEvent(pendingId))?.data).toMatchObject({
          deliveryStatus: 'cancelled',
        });
      } else expect(context.operations()).toEqual([]);
    },
  );

  it('allows new input after failed retirement without reviving cancelled work', async () => {
    const context = fixture();
    await pauseQueue(context);
    await context.worker.acceptMessage('s', 'old', [], 'old');
    await expect(
      context.worker.retireSession(
        's',
        'session.archive',
        {},
        async () => {},
        async () => {
          throw new Error('archive failed');
        },
      ),
    ).rejects.toThrow('archive failed');
    await context.worker.acceptMessage('s', 'new', [], 'new');
    await context.worker.resumeQueue('s');
    await context.worker.idle('s');
    expect(context.dispatch.mock.calls.map(([, message]) => message.text)).toEqual(['new']);
    expect(context.operations().find((row) => row.commandId === 'old')?.status).toBe('cancelled');
    expect(context.operations().find((row) => row.kind === 'session.archive')?.status).toBe(
      'failed',
    );
  });
});

it.each([401, 402, 429])(
  'persists one structured rejection for provider response %s and pauses later input',
  async (code) => {
    let context: ReturnType<typeof fixture>;
    context = fixture(async (_session, message) => {
      context.db
        .update(sessionTurnAttempts)
        .set({ dispatchedAt: new Date() })
        .where(eq(sessionTurnAttempts.id, message.attemptId))
        .run();
      throw new AgentPromptRejectedError({
        code,
        message: 'Provider refused request',
        data: { private: 'secret', retryAfterMs: 3000 },
      });
    });
    await pauseQueue(context);
    const eventId = await context.worker.acceptMessage('s', 'first', [], 'first');
    await context.worker.acceptMessage('s', 'second', [], 'second');
    await context.worker.resumeQueue('s');
    await context.worker.idle('s');
    const failures = context.db
      .select()
      .from(sessionEvents)
      .all()
      .map((row) => ({ ...row, data: JSON.parse(row.data) }))
      .filter((row) => row.data.status === 'prompt_failed');
    expect(failures).toHaveLength(1);
    expect(failures[0].parentEventId).toBe(eventId);
    const failure = chatErrorSchema.parse(failures[0].data.error);
    expect(failure).toMatchObject({ code, delivery: 'rejected', providerId: 'provider', eventId });
    expect(failure.actions).toContain('retry');
    expect(JSON.stringify(failure)).not.toContain('secret');
    expect(readSessionExecutionState(context.db, 's').error).toEqual(failure);
    expect(context.operations().map((operation) => operation.status)).toEqual([
      'failed',
      'pending',
    ]);
    expect(context.dispatch).toHaveBeenCalledOnce();
  },
);

it.each([false, true])(
  'gives the worker sole ownership of a runtime failure (provider accepted=%s)',
  async (accepted) => {
    let runtime: SessionRuntime;
    const context = fixture(async (_session, message) => {
      await runtime.prompt(message.text, [], undefined, undefined, undefined, undefined, message);
    });
    const handle = {
      id: 'remote',
      history: 'fresh',
      closed: new Promise<void>(() => undefined),
      onError: () => undefined,
      onClose: () => undefined,
      close: async () => {},
      prompt: async () => {
        if (accepted)
          await runtime.handleDomainEvent({
            type: 'user_message_accepted',
            messageId: 'remote-message',
          });
        throw new AgentError(
          'authentication_required',
          'Authentication required\nAgent stderr: internal timings',
          { delivery: 'rejected' },
        );
      },
    } as unknown as AgentSession;
    runtime = new SessionRuntime('s', handle, context.db, context.events, '/tmp/project');
    const eventId = await context.worker.acceptMessage('s', 'hello');
    await context.worker.idle('s');
    const events = context.db
      .select()
      .from(sessionEvents)
      .all()
      .map((row) => ({ ...row, data: JSON.parse(row.data) }));
    expect(events.filter((row) => row.data.status === 'prompt_failed')).toHaveLength(1);
    expect(events.filter((row) => row.data.status === 'operation_failed')).toHaveLength(0);
    expect(events.find((row) => row.data.status === 'runtime_error')?.data.diagnosticOnly).toBe(
      true,
    );
    const state = readSessionExecutionState(context.db, 's');
    expect(state).toMatchObject({
      execution: 'failed',
      attention: 'error',
      queue: [],
      error: { delivery: accepted ? 'accepted' : 'rejected' },
    });
    expect((await context.events.getEvent(eventId))?.data).toMatchObject({
      deliveryStatus: accepted ? 'accepted' : 'failed',
    });
    if (accepted) expect(chatErrorSchema.parse(state.error).actions).not.toContain('retry');
  },
);

it('pauses queued follow-ups when an inserted foreground turn fails without throwing', async () => {
  let context: ReturnType<typeof fixture>;
  context = fixture(async (_session, message) => {
    context.db
      .update(sessionTurnAttempts)
      .set({ status: 'failed' })
      .where(eq(sessionTurnAttempts.id, message.attemptId))
      .run();
  });
  await pauseQueue(context);
  await context.worker.acceptMessage('s', 'first', [], 'first');
  await context.worker.acceptMessage('s', 'second', [], 'second');
  await context.worker.resumeQueue('s');
  await context.worker.idle('s');
  expect(context.operations().map((operation) => operation.status)).toEqual(['failed', 'pending']);
  expect(context.db.select().from(sessions).get()?.status).toBe('error');
  expect(context.dispatch).toHaveBeenCalledOnce();
});

it('reports a newer independent runtime failure instead of retaining a historical turn error', async () => {
  const context = fixture(async () => {
    throw new Error('Old failure');
  });
  await context.worker.acceptMessage('s', 'hello');
  await context.worker.idle('s');
  const failure = normalizeChatError(
    new AgentError('transport_lost', 'Independent connection failure'),
    { stage: 'dispatch', id: 'new-runtime-failure' },
  );
  await context.events.append('s', 'status', { status: 'runtime_error', error: failure });
  expect(readSessionExecutionState(context.db, 's').error).toEqual(failure);
});

it('does not turn an explicitly failed inserted attempt into a successful operation', async () => {
  let context: ReturnType<typeof fixture>;
  context = fixture(async (_session, message) => {
    context.db
      .update(sessionTurnAttempts)
      .set({ status: 'failed', endedAt: new Date() })
      .where(eq(sessionTurnAttempts.id, message.attemptId))
      .run();
  });
  await context.worker.acceptMessage('s', 'hello');
  await context.worker.idle('s');
  expect(context.operations()[0].status).toBe('failed');
  expect(context.attempts()[0].status).toBe('failed');
});

it('rolls back acceptance, tokens and cursors together when inserting the attempt fails', async () => {
  const context = fixture();
  context.db.run(
    "CREATE TRIGGER reject_attempt BEFORE INSERT ON session_turn_attempts BEGIN SELECT RAISE(ABORT, 'attempt unavailable'); END",
  );
  const publish = vi.spyOn(context.events, 'publishCommitted');
  await expect(context.worker.acceptMessage('s', 'hello', [], 'retry')).rejects.toThrow(
    'attempt unavailable',
  );
  expect(context.operations()).toEqual([]);
  expect(context.attempts()).toEqual([]);
  expect(context.db.select().from(sessionEvents).all()).toEqual([]);
  expect(context.db.select().from(sessions).get()?.totalTokens).toBe(0);
  expect(publish).not.toHaveBeenCalled();
  expect(context.dispatch).not.toHaveBeenCalled();
  context.db.run('DROP TRIGGER reject_attempt');
  await context.worker.acceptMessage('s', 'hello', [], 'retry');
  await context.worker.idle('s');
  expect(context.dispatch).toHaveBeenCalledOnce();
});
