import { createServerServices } from '../composition/server-services.js';
import Fastify from 'fastify';
import { eq } from 'drizzle-orm';
import { validatorCompiler } from '@fastify/type-provider-zod';
import { createDatabase, projects, sessions, sessionEvents } from '@agentctl/core/db';
import {
  sessionEventPageSchema,
  sessionTurnIndexSchema,
  sessionEventRowSchema,
} from '@agentctl/shared';
import { expect, it } from 'vite-plus/test';
import { eventsRoutes } from './events.js';

it('returns bounded chronological pages, with turn anchors and session-scoped cursors', async () => {
  const app = Fastify();
  const db = createDatabase(':memory:');
  app.decorate('db', db);
  app.setValidatorCompiler(validatorCompiler);
  app.decorate('services', createServerServices(app));
  await app.register(eventsRoutes, { prefix: '/api' });
  const id = '11111111-1111-4111-8111-111111111111';
  const other = '22222222-2222-4222-8222-222222222222';
  db.insert(projects).values({ id: 'project', name: 'Project', path: '/tmp/project' }).run();
  for (const sessionId of [id, other])
    db.insert(sessions)
      .values({
        id: sessionId,
        projectId: 'project',
        branch: 'main',
        worktreePath: '/tmp/project',
        taskSlug: sessionId,
        baseCommit: 'none',
        agent: 'agent',
        selectedProvider: 'agent',
      })
      .run();
  for (let eventId = 1; eventId <= 8; eventId++)
    db.insert(sessionEvents)
      .values({
        id: eventId,
        sessionId: eventId === 4 ? other : id,
        type: 'text',
        parentEventId: eventId > 1 && eventId !== 4 ? 1 : null,
        data: JSON.stringify({
          role: eventId === 1 ? 'user' : 'provider',
          content: String(eventId),
        }),
      })
      .run();
  try {
    const fetch = async (query: string) => {
      const response = await app.inject(`/api/sessions/${id}/events/page?${query}`);
      expect(response.statusCode).toBe(200);
      return sessionEventPageSchema.parse(response.json());
    };
    const first = await fetch('limit=3');
    expect(first.events.map((event) => event.id)).toEqual([1, 6, 7, 8]);
    expect(first.nextBeforeId).toBe(6);
    const second = await fetch(`limit=3&beforeId=${first.nextBeforeId}`);
    expect(second.events.map((event) => event.id)).toEqual([1, 2, 3, 5]);
    expect(second.nextBeforeId).toBe(2);
    const last = await fetch('limit=3&beforeId=2');
    expect(last.events.map((event) => event.id)).toEqual([1]);
    expect(last.nextBeforeId).toBeNull();
    expect((await app.inject(`/api/sessions/${id}/events/page?limit=501`)).statusCode).toBe(400);
    expect((await fetch('beforeId=1')).events).toEqual([]);
    const window = await fetch('aroundId=5&limit=2');
    expect(window.events.map((event) => event.id)).toEqual([5, 6]);
    expect(window.nextBeforeId).toBe(5);
    expect(window.nextAfterId).toBe(6);
    const forward = await fetch('afterId=6&limit=2');
    expect(forward.events.map((event) => event.id)).toEqual([7, 8]);
    expect(forward.nextAfterId).toBeNull();
    expect((await app.inject(`/api/sessions/${id}/events/page?aroundId=4`)).statusCode).toBe(404);
    expect(
      (await app.inject(`/api/sessions/${id}/events/page?aroundId=5&beforeId=6`)).statusCode,
    ).toBe(400);
  } finally {
    await app.close();
  }
});

it('indexes every foreground turn independently of message pages with bounded prompt previews', async () => {
  const app = Fastify();
  const db = createDatabase(':memory:');
  app.decorate('db', db);
  app.setValidatorCompiler(validatorCompiler);
  app.decorate('services', createServerServices(app));
  await app.register(eventsRoutes, { prefix: '/api' });
  const id = '11111111-1111-4111-8111-111111111111';
  const other = '22222222-2222-4222-8222-222222222222';
  db.insert(projects).values({ id: 'project', name: 'Project', path: '/tmp/project' }).run();
  for (const sessionId of [id, other])
    db.insert(sessions)
      .values({
        id: sessionId,
        projectId: 'project',
        branch: 'main',
        worktreePath: '/tmp/project',
        taskSlug: sessionId,
        baseCommit: 'none',
        agent: 'agent',
        selectedProvider: 'agent',
      })
      .run();
  for (let turn = 0; turn < 250; turn++) {
    db.insert(sessionEvents)
      .values({
        sessionId: id,
        type: 'text',
        data: JSON.stringify({
          role: 'user',
          content: turn === 0 ? 'p'.repeat(4096) : `Prompt ${turn + 1}`,
        }),
      })
      .run();
    db.insert(sessionEvents)
      .values({
        sessionId: id,
        type: 'text',
        data: JSON.stringify({ role: 'provider', content: 'response body omitted '.repeat(1000) }),
      })
      .run();
  }
  db.insert(sessionEvents)
    .values({
      sessionId: id,
      type: 'text',
      metadata: JSON.stringify({ nativeSessionId: 'child' }),
      data: JSON.stringify({ role: 'user', content: 'Child prompt' }),
    })
    .run();
  db.insert(sessionEvents)
    .values({
      sessionId: other,
      type: 'text',
      data: JSON.stringify({ role: 'user', content: 'Other session prompt' }),
    })
    .run();
  try {
    const response = await app.inject(`/api/sessions/${id}/events/turns`);
    expect(response.statusCode).toBe(200);
    const index = sessionTurnIndexSchema.parse(response.json());
    expect(index).toHaveLength(250);
    expect(index[0].prompt).toHaveLength(600);
    expect(index.at(-1)?.prompt).toBe('Prompt 250');
    expect(index.map((turn) => turn.eventId)).toEqual(
      Array.from({ length: 250 }, (_, i) => i * 2 + 1),
    );
    expect(index[0].summary).toHaveLength(1000);
    expect(response.body).not.toContain('response body omitted '.repeat(1000));
    expect(response.body).not.toContain('Child prompt');
    expect(response.body).not.toContain('Other session prompt');
    const page = sessionEventPageSchema.parse(
      (await app.inject(`/api/sessions/${id}/events/page`)).json(),
    );
    expect(page.events.length).toBeLessThanOrEqual(200);
    expect(page.nextBeforeId).not.toBeNull();
  } finally {
    await app.close();
  }
});

it('returns a complete error for a corrupt later row without sending earlier event payloads', async () => {
  const app = Fastify();
  const db = createDatabase(':memory:');
  app.decorate('db', db);
  app.setValidatorCompiler(validatorCompiler);
  app.decorate('services', createServerServices(app));
  await app.register(eventsRoutes, { prefix: '/api' });
  const id = '11111111-1111-4111-8111-111111111111';
  db.insert(projects).values({ id: 'p', name: 'Project', path: '/tmp/project' }).run();
  db.insert(sessions)
    .values({
      id,
      projectId: 'p',
      branch: 'main',
      worktreePath: '/tmp/project',
      taskSlug: 'task',
      baseCommit: 'none',
      agent: 'agent',
      selectedProvider: 'agent',
    })
    .run();
  for (const eventId of [1, 2])
    db.insert(sessionEvents)
      .values({
        id: eventId,
        sessionId: id,
        type: 'text',
        data: JSON.stringify({ role: 'provider', content: 'must not leak in an error' }),
        metadata: eventId === 2 ? '{' : null,
      })
      .run();
  try {
    const response = await app.inject(`/api/sessions/${id}/events/page`);
    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ statusCode: 500 });
    expect(response.body).not.toContain('must not leak in an error');
    const healthy = await app.inject(`/api/sessions/${id}/events/page?beforeId=2`);
    expect(healthy.statusCode).toBe(200);
    expect(sessionEventPageSchema.parse(healthy.json()).events.map((row) => row.id)).toEqual([1]);
  } finally {
    await app.close();
  }
});

it('returns compact pages with unchanged cursors and retrieves complete, session-scoped current details', async () => {
  const app = Fastify();
  const db = createDatabase(':memory:');
  app.decorate('db', db);
  app.setValidatorCompiler(validatorCompiler);
  app.decorate('services', createServerServices(app));
  await app.register(eventsRoutes, { prefix: '/api' });
  const id = '11111111-1111-4111-8111-111111111111';
  const other = '22222222-2222-4222-8222-222222222222';
  db.insert(projects).values({ id: 'project', name: 'Project', path: '/tmp/project' }).run();
  for (const sessionId of [id, other])
    db.insert(sessions)
      .values({
        id: sessionId,
        projectId: 'project',
        branch: 'main',
        worktreePath: '/tmp/project',
        taskSlug: sessionId,
        baseCommit: 'none',
        agent: 'agent',
        selectedProvider: 'agent',
      })
      .run();
  db.insert(sessionEvents)
    .values({
      id: 1,
      sessionId: id,
      type: 'text',
      data: JSON.stringify({ role: 'user', content: 'keep conversation complete' }),
    })
    .run();
  db.insert(sessionEvents)
    .values({
      id: 2,
      parentEventId: 1,
      sessionId: id,
      type: 'tool_call',
      data: JSON.stringify({
        name: 'read',
        kind: 'read',
        status: 'completed',
        rawOutput: 'full output '.repeat(1000),
        arguments: { path: '/file' },
      }),
      metadata: JSON.stringify({ nativeSessionId: 'child' }),
    })
    .run();
  try {
    const full = sessionEventPageSchema.parse(
      (await app.inject(`/api/sessions/${id}/events/page?limit=1`)).json(),
    );
    const compact = sessionEventPageSchema.parse(
      (await app.inject(`/api/sessions/${id}/events/page?limit=1&compact=true`)).json(),
    );
    expect(compact.events.map((event) => event.id)).toEqual(full.events.map((event) => event.id));
    expect(compact.nextBeforeId).toBe(full.nextBeforeId);
    expect(compact.events[0]).toEqual(full.events[0]);
    expect(compact.events[1]).toMatchObject({
      parentEventId: 1,
      metadata: { nativeSessionId: 'child' },
      details: { revision: expect.any(String) },
    });
    expect(JSON.stringify(compact)).not.toContain('full output');
    const detail = await app.inject(`/api/sessions/${id}/events/2/detail`);
    expect(detail.statusCode).toBe(200);
    expect(detail.headers['cache-control']).toBe('no-store');
    expect(sessionEventRowSchema.parse(detail.json().event)).toEqual(full.events[1]);
    expect(detail.json().revision).toBe(compact.events[1].details?.revision);
    expect((await app.inject(`/api/sessions/${other}/events/2/detail`)).statusCode).toBe(404);
    expect((await app.inject(`/api/sessions/${id}/events/0/detail`)).statusCode).toBe(400);
    db.update(sessionEvents)
      .set({
        data: JSON.stringify({
          name: 'read',
          kind: 'read',
          status: 'completed',
          rawOutput: 'updated output',
        }),
      })
      .where(eq(sessionEvents.id, 2))
      .run();
    const updated = await app.inject(`/api/sessions/${id}/events/2/detail`);
    expect(updated.json().event.data.rawOutput).toBe('updated output');
    expect(updated.json().revision).not.toBe(detail.json().revision);
    db.delete(sessionEvents).where(eq(sessionEvents.id, 2)).run();
    expect((await app.inject(`/api/sessions/${id}/events/2/detail`)).statusCode).toBe(404);
  } finally {
    await app.close();
  }
});
