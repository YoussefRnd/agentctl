import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { createDatabase, projects, sessionEvents, sessions } from '@agentctl/core/db';

describe('Projects routes', () => {
  let app: FastifyInstance;
  const projectId = '10000000-0000-4000-8000-000000000001';
  const sessionWithMessageId = '20000000-0000-4000-8000-000000000001';
  const emptySessionId = '20000000-0000-4000-8000-000000000002';

  beforeEach(async () => {
    const db = createDatabase(':memory:');

    await db.insert(projects).values({
      id: projectId,
      name: 'Project',
      path: '/tmp/project',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    await db.insert(sessions).values([
      {
        id: sessionWithMessageId,
        projectId,
        branch: 'main',
        worktreePath: '/tmp/project',
        taskSlug: 'with-message',
        baseCommit: 'c0ffee',
        agent: 'test-agent',
        selectedProvider: 'test-provider',
        lastActivityAt: new Date('2026-01-02T00:00:00.000Z'),
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-09-14T12:00:00.000Z'),
      },
      {
        id: emptySessionId,
        projectId,
        branch: 'main',
        worktreePath: '/tmp/project',
        taskSlug: 'empty',
        baseCommit: 'c0ffee',
        agent: 'test-agent',
        selectedProvider: 'test-provider',
        lastActivityAt: new Date('2026-01-03T00:00:00.000Z'),
        createdAt: new Date('2026-01-03T00:00:00.000Z'),
        updatedAt: new Date('2026-01-03T00:00:00.000Z'),
      },
    ]);

    await db.insert(sessionEvents).values([
      {
        sessionId: sessionWithMessageId,
        type: 'text',
        data: JSON.stringify({ role: 'user', content: 'hello' }),
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
      },
      {
        sessionId: sessionWithMessageId,
        type: 'status',
        data: JSON.stringify({ status: 'session_info_update' }),
        createdAt: new Date('2026-09-14T12:00:00.000Z'),
      },
    ]);

    app = await buildApp({ db, embedded: true });
  });

  afterEach(async () => {
    await app.close();
  });

  it('uses message activity instead of administrative session updates', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/projects' });

    expect(response.statusCode).toBe(200);
    const [project] = response.json() as Array<{
      sessions: Array<{ id: string; lastActivityAt: string; hasUserActivity: boolean }>;
    }>;

    expect(project.sessions.map(({ id, lastActivityAt }) => ({ id, lastActivityAt }))).toEqual([
      {
        id: emptySessionId,
        lastActivityAt: '2026-01-03T00:00:00.000Z',
      },
      {
        id: sessionWithMessageId,
        lastActivityAt: '2026-01-02T00:00:00.000Z',
      },
    ]);
    expect(project.sessions.map(({ id, hasUserActivity }) => ({ id, hasUserActivity }))).toEqual([
      { id: emptySessionId, hasUserActivity: false },
      { id: sessionWithMessageId, hasUserActivity: true },
    ]);
  });
});
