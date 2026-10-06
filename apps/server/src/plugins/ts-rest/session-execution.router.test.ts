import Fastify from 'fastify';
import { initServer } from '@ts-rest/fastify';
import { sessionsContract } from '@agentctl/shared';
import { createDatabase, projects, sessions, sessionOperations } from '@agentctl/core/db';
import { eq } from 'drizzle-orm';
import { SessionOperationWorker } from '../../../../../packages/core/src/session/execution/session-operation-worker.js';
import { SessionEventRepository } from '@agentctl/core/session';
import { noopLogger } from '../../../../../packages/core/src/logger.js';
import { randomUUID } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import { createSessionsRouter } from './sessions.router.js';

test('accepted queue survives independent API reads and supports reorder and cancellation', async () => {
  const db = createDatabase(':memory:');
  const id = randomUUID();
  db.insert(projects).values({ id: 'p', name: 'Project', path: '/tmp/project' }).run();
  db.insert(sessions)
    .values({
      id,
      projectId: 'p',
      worktreePath: '/tmp/project',
      branch: 'main',
      baseCommit: 'none',
      agent: 'profile-a',
      selectedProvider: 'profile-a',
      taskSlug: 'task',
    })
    .run();
  let finish!: () => void;
  const hold = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const dispatched: string[] = [];
  const events = new SessionEventRepository(db, { publish() {} });
  const error = {
    message: 'Provider failure details. '.repeat(60),
    code: -32000,
    data: { reason: 'quota' },
  };
  const timings = { preparationMs: 12, acceptanceMs: 5, firstOutputMs: 9, completionMs: 80 };
  const worker = new SessionOperationWorker(
    db,
    events,
    async (_id, message) => {
      dispatched.push(message.text);
      if (message.text === 'active') await hold;
      if (message.text === 'first') {
        await events.append(
          id,
          'status',
          { status: 'prompt_failed', message: error.message, error, timings },
          message.eventId,
          { attemptId: message.attemptId },
        );
        throw new Error(error.message);
      }
    },
    noopLogger,
  );
  await worker.acceptMessage(id, 'active', [], 'active');
  await worker.acceptMessage(id, 'first', [], 'first');
  await worker.acceptMessage(id, 'second', [], 'second');
  await worker.acceptMessage(id, 'cancel-me', [], 'cancel-me');
  const app = Fastify();
  app.decorate('db', db);
  app.decorate('sessionManager', {
    changeQueuedMessage: worker.changeQueuedMessage.bind(worker),
    resumeSessionQueue: worker.resumeQueue.bind(worker),
  } as never);
  app.decorate('eventBus', { publishState: vi.fn() } as never);
  const server = initServer();
  await app.register(server.plugin(server.router(sessionsContract, createSessionsRouter(app))));
  try {
    expect((await app.inject(`/api/sessions/${id}/execution`)).json()).toMatchObject({
      execution: 'running',
      attention: 'none',
      queue: [{ id: 'first' }, { id: 'second' }, { id: 'cancel-me' }],
    });
    const move = await app.inject({
      method: 'POST',
      url: `/api/sessions/${id}/queue/second`,
      payload: { action: 'up' },
    });
    expect(move.statusCode).toBe(200);
    expect(
      (await app.inject(`/api/sessions/${id}/execution`))
        .json()
        .queue.map((message: { id: string }) => message.id),
    ).toEqual(['second', 'first', 'cancel-me']);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/sessions/${id}/queue/cancel-me`,
          payload: { action: 'cancel' },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/sessions/${id}/queue/active`,
          payload: { action: 'cancel' },
        })
      ).statusCode,
    ).toBe(409);
    finish();
    await worker.idle(id);
    expect(dispatched).toEqual(['active', 'second', 'first']);
    expect((await app.inject(`/api/sessions/${id}/execution`)).json()).toMatchObject({
      execution: 'failed',
      error,
      timings,
      queue: [],
    });
    // Reads reconstruct diagnostics from durable rows, without a live turn executor.
    const restored = (await app.inject(`/api/sessions/${id}/execution`)).json();
    expect(restored).toMatchObject({ error, timings });
    expect(
      db.select().from(sessionOperations).where(eq(sessionOperations.commandId, 'first')).get()
        ?.error,
    ).toBe(error.message);
  } finally {
    finish();
    await worker.idle(id);
    await app.close();
  }
});
