import { randomUUID } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import { createDatabase, projects, sessions, nativeSessionImports } from '@agentctl/core/db';
import type { SessionManager } from '@agentctl/core/session';
import type { ProviderRegistry } from '@agentctl/core/providers';
import type { WorktreeManager } from '@agentctl/core/git';
import type { FastifyBaseLogger } from 'fastify';
import { SessionService } from './session-service.js';

function setup() {
  const db = createDatabase(':memory:');
  const projectId = randomUUID();
  db.insert(projects).values({ id: projectId, name: 'Project', path: '/tmp' }).run();
  const manager = {
    createSession: vi.fn(async (params: { providerId: string; projectId: string }) => {
      const sessionId = randomUUID();
      db.insert(sessions)
        .values({
          id: sessionId,
          projectId: params.projectId,
          worktreePath: '/tmp',
          branch: 'main',
          baseCommit: 'none',
          agent: params.providerId,
          selectedProvider: params.providerId,
          taskSlug: 'imported',
        })
        .run();
      return { sessionId };
    }),
    restartSession: vi.fn().mockResolvedValue({ requiresHistoryContext: false, flushAll: vi.fn() }),
    stopSessionAndWait: vi.fn().mockResolvedValue(undefined),
  };
  const registry = {
    ensureProviderReady: vi.fn().mockResolvedValue({ features: { sessions: { resume: true } } }),
  };
  const service = () =>
    new SessionService(
      db,
      manager as unknown as SessionManager,
      {} as WorktreeManager,
      registry as unknown as ProviderRegistry,
      {} as FastifyBaseLogger,
    );
  return { db, projectId, manager, registry, service };
}
test('concurrent imports and imports after restart reuse the persisted identity', async () => {
  const { db, projectId, manager, service } = setup();
  const importer = service();
  const params = {
    projectId,
    providerId: 'profile-a',
    nativeSessionId: 'native',
    title: 'Existing work',
  };
  const [first, second] = await Promise.all([
    importer.importNativeSession(params),
    importer.importNativeSession(params),
  ]);
  expect(first).toEqual(second);
  expect(manager.createSession).toHaveBeenCalledTimes(1);
  expect(manager.restartSession).toHaveBeenCalledWith(first.sessionId, { nativeImport: true });
  expect(await service().importNativeSession(params)).toEqual(first);
  expect(manager.restartSession).toHaveBeenCalledTimes(1);
  expect(db.select().from(nativeSessionImports).get()?.completed).toBe(true);
  const otherProfile = await importer.importNativeSession({ ...params, providerId: 'profile-b' });
  expect(otherProfile.sessionId).not.toBe(first.sessionId);
  expect(db.select().from(sessions).all()).toHaveLength(2);
});
test('a failed native load remains retryable and never counts as an imported session', async () => {
  const { db, projectId, manager, service } = setup();
  const importer = service();
  const params = { projectId, providerId: 'provider', nativeSessionId: 'missing' };
  manager.restartSession.mockRejectedValueOnce(new Error('Session not found'));
  await expect(importer.importNativeSession(params)).rejects.toThrow('Session not found');
  expect(db.select().from(nativeSessionImports).get()?.completed).toBe(false);
  await importer.importNativeSession(params);
  expect(manager.createSession).toHaveBeenCalledTimes(1);
  expect(db.select().from(nativeSessionImports).get()?.completed).toBe(true);
});
test('loading is capability gated before creating local state', async () => {
  const { db, projectId, registry, service } = setup();
  registry.ensureProviderReady.mockResolvedValue({ features: { sessions: { resume: false } } });
  await expect(
    service().importNativeSession({ projectId, providerId: 'provider', nativeSessionId: 'id' }),
  ).rejects.toThrow('does not support');
  expect(db.select().from(sessions).all()).toHaveLength(0);
});
