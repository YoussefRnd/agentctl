import { createServerServices } from '../../composition/server-services.js';
import Fastify from 'fastify';
import { initServer } from '@ts-rest/fastify';
import { providersContract } from '@agentctl/shared';
import { createDatabase, projects, sessions, nativeSessionImports } from '@agentctl/core/db';
import { randomUUID } from 'node:crypto';
import { expect, test, vi } from 'vite-plus/test';
import { createProvidersRouter } from './providers.router.js';

test('native listing scopes cwd to the project and import annotations to the configured profile', async () => {
  const app = Fastify();
  const db = createDatabase(':memory:');
  const projectId = randomUUID();
  const sessionId = randomUUID();
  db.insert(projects).values({ id: projectId, name: 'Project', path: '/tmp/project' }).run();
  db.insert(sessions)
    .values({
      id: sessionId,
      projectId,
      worktreePath: '/tmp/project',
      branch: 'main',
      baseCommit: 'none',
      agent: 'profile-a',
      selectedProvider: 'profile-a',
      taskSlug: 'import',
    })
    .run();
  db.insert(nativeSessionImports)
    .values({
      projectId,
      providerId: 'profile-a',
      nativeSessionId: 'native',
      sessionId,
      completed: true,
    })
    .run();
  const list = vi.fn().mockResolvedValue({
    sessions: [
      { sessionId: 'native', cwd: '/tmp/project', title: 'Existing' },
      { sessionId: 'other', cwd: '/tmp/other' },
    ],
    nextCursor: 'next-page',
  });
  app.decorate('db', db);
  app.decorate('providerRegistry', { listNativeSessions: list } as never);
  app.decorate('services', createServerServices(app));
  const server = initServer();
  await app.register(server.plugin(server.router(providersContract, createProvidersRouter(app))));
  try {
    const first = await app.inject(
      `/api/providers/profile-a/native-sessions?projectId=${projectId}&cursor=previous`,
    );
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({
      sessions: [
        {
          sessionId: 'native',
          cwd: '/tmp/project',
          title: 'Existing',
          importedSessionId: sessionId,
        },
      ],
      nextCursor: 'next-page',
    });
    expect(list).toHaveBeenCalledWith('profile-a', '/tmp/project', 'previous');
    const second = await app.inject(
      `/api/providers/profile-b/native-sessions?projectId=${projectId}`,
    );
    expect(second.json().sessions[0].importedSessionId).toBeUndefined();
    expect(
      (await app.inject('/api/providers/profile-a/native-sessions?projectId=invalid')).statusCode,
    ).toBe(400);
  } finally {
    await app.close();
  }
});
