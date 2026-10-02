import Fastify from 'fastify';
import { validatorCompiler } from '@fastify/type-provider-zod';
import { createDatabase, projects, sessions, sessionEvents } from '@agentctl/core/db';
import { sessionEventPageSchema } from '@agentctl/shared';
import { expect, it } from 'vitest';
import { eventsRoutes } from './events.js';

it('returns bounded chronological pages, with turn anchors and session-scoped cursors', async () => {
  const app = Fastify();
  const db = createDatabase(':memory:');
  app.decorate('db', db);
  app.setValidatorCompiler(validatorCompiler);
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
  } finally {
    await app.close();
  }
});
