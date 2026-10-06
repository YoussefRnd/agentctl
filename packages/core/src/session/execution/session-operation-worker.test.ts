import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDatabase, projects, sessions, sessionEvents } from '../../db/index.js';
import { sessionOperations, sessionTurnAttempts, sessionRuntimeBindings } from '../../db/schema.js';
import { noopLogger } from '../../logger.js';
import { AgentError } from '../../agent/errors.js';
import { SessionEventRepository } from '../persistence/session-event-repository.js';
import { SessionOperationWorker, type PendingSessionMessage } from './session-operation-worker.js';

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
      expect(context.operations()[0]).toMatchObject({ status, error: 'provider lost' });
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

  it('records an explicit insertion rejection as failed even after dispatch', async () => {
    let context: ReturnType<typeof fixture>;
    context = fixture(async (_session, message) => {
      context.db
        .update(sessionTurnAttempts)
        .set({ dispatchedAt: new Date() })
        .where(eq(sessionTurnAttempts.id, message.attemptId))
        .run();
      throw new AgentError('prompt_rejected', 'Input rejected');
    });
    const eventId = await context.worker.acceptMessage('s', 'hello');
    await context.worker.idle('s');
    expect(context.operations()[0]).toMatchObject({ status: 'failed', error: 'Input rejected' });
    expect(context.attempts()[0].status).toBe('failed');
    expect((await context.events.getEvent(eventId))?.data).toMatchObject({
      deliveryStatus: 'failed',
    });
  });

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
