import { expect, test, vi } from 'vite-plus/test';
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
    contextUsedTokens: null,
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

test('session responses preserve reported occupancy and separate last-turn consumption', async () => {
  const { db, queries } = setup();
  db.update(sessions)
    .set({
      contextUsedTokens: 161651,
      contextLimit: 200000,
      totalTokens: 1581561,
      sessionMetrics: JSON.stringify({
        reportedCost: { amount: 0.42, currency: 'EUR' },
        lastTurn: {
          totalTokens: 1581561,
          cachedReadTokens: 1564544,
          cost: { amount: 0, currency: 'CAD' },
        },
      }),
    })
    .run();
  const detail = await queries.withCapabilities(
    await queries.findDetail('22222222-2222-4222-8222-222222222222'),
  );
  const expected = {
    contextUsedTokens: 161651,
    totalTokens: 1581561,
    contextLimit: 200000,
    sessionMetrics: {
      reportedCost: { amount: 0.42, currency: 'EUR' },
      lastTurn: {
        totalTokens: 1581561,
        cachedReadTokens: 1564544,
        cost: { amount: 0, currency: 'CAD' },
      },
    },
  };
  expect(detail.session).toMatchObject(expected);
  expect((await queries.list())[0]).toMatchObject(expected);
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

test('legacy zero estimates and malformed cost fields do not become known reported prices or break reads', async () => {
  const { db, queries } = setup();
  db.update(sessions)
    .set({
      sessionMetrics: JSON.stringify({
        estimatedCost: 0,
        cost: { amount: 0 },
        reportedCost: { amount: 1, currency: '' },
        lastTurn: { cost: { amount: 0 } },
      }),
    })
    .run();
  const result = (await queries.list())[0]!;
  expect(result.sessionMetrics.reportedCost).toBeNull();
  expect(result.sessionMetrics.lastTurn?.cost).toBeUndefined();
});
