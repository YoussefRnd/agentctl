import { expect, test, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDatabase, projects, sessions } from '@agentctl/core/db';
import { SessionQueries } from './session-queries.js';
import { SessionReconciler } from './session-reconciler.js';

function setup() {
  const db = createDatabase(':memory:');
  db.insert(projects)
    .values({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Project',
      path: '/project',
      repoRoot: '/project',
    })
    .run();
  db.insert(sessions)
    .values({
      id: '22222222-2222-4222-8222-222222222222',
      projectId: '11111111-1111-4111-8111-111111111111',
      worktreePath: '/project',
      mode: 'worktree',
      branch: 'before',
      baseCommit: 'old',
      agent: 'test',
      selectedProvider: 'test',
      taskSlug: 'task',
      sessionMetrics: JSON.stringify({ contextLimit: 1234 }),
    })
    .run();
  const queries = new SessionQueries(db, { discover: vi.fn().mockResolvedValue([]) });
  const track = vi.fn().mockResolvedValue('captured');
  const manager = {
    ensureWorkspaceAvailable: vi.fn().mockResolvedValue(true),
    getCheckpointService: () => ({ track }),
    getEventRepository: () => ({
      recalculateTotalTokens: vi.fn(async () => {
        db.update(sessions)
          .set({ totalTokens: 77 })
          .where(eq(sessions.id, '22222222-2222-4222-8222-222222222222'))
          .run();
      }),
    }),
  };
  const reconciler = new SessionReconciler(db, manager as never, {
    getCurrentBranch: vi.fn().mockResolvedValue('after'),
  });
  return { db, queries, reconciler, manager, track };
}

test('query assembly is inert until explicit legacy reconciliation repairs the same response model', async () => {
  const { db, queries, reconciler, manager, track } = setup();
  const record = await queries.findDetail('22222222-2222-4222-8222-222222222222');
  expect((await queries.withCapabilities(record)).session).toMatchObject({
    branch: 'before',
    baseCommit: 'old',
    totalTokens: 0,
    contextLimit: 0,
  });
  expect(manager.ensureWorkspaceAvailable).not.toHaveBeenCalled();
  expect(track).not.toHaveBeenCalled();
  await reconciler.reconcile(record);
  expect((await queries.withCapabilities(record)).session).toMatchObject({
    branch: 'after',
    baseCommit: 'captured',
    totalTokens: 77,
    contextLimit: 1234,
  });
  expect(db.select().from(sessions).get()).toMatchObject({
    branch: 'after',
    baseCommit: 'captured',
    totalTokens: 77,
    contextLimit: 1234,
  });
  expect(manager.ensureWorkspaceAvailable).toHaveBeenCalledExactlyOnceWith(
    '22222222-2222-4222-8222-222222222222',
  );
});

test('missing sessions and failed workspace recovery do not silently continue repair', async () => {
  const { queries, reconciler, manager, track, db } = setup();
  await expect(queries.findDetail('missing')).rejects.toMatchObject({ statusCode: 404 });
  const failure = new Error('Workspace unavailable');
  manager.ensureWorkspaceAvailable.mockRejectedValue(failure);
  await expect(
    reconciler.reconcile(await queries.findDetail('22222222-2222-4222-8222-222222222222')),
  ).rejects.toBe(failure);
  expect(track).not.toHaveBeenCalled();
  expect(db.select().from(sessions).get()).toMatchObject({
    branch: 'before',
    totalTokens: 0,
    contextLimit: 0,
  });
});
