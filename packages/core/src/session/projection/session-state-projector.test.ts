import { expect, test } from 'vite-plus/test';
import { createDatabase, projects, sessions } from '../../db/index.js';
import { eq } from 'drizzle-orm';
import { SessionEventRepository } from '../persistence/session-event-repository.js';
import { SessionStateProjector } from './session-state-projector.js';

test('persists live reasoning selections and clears the override when the option is removed', async () => {
  const db = createDatabase(':memory:');
  db.insert(projects).values({ id: 'p', name: 'Project', path: '/tmp' }).run();
  db.insert(sessions)
    .values({
      id: 's',
      projectId: 'p',
      worktreePath: '/tmp',
      branch: 'main',
      baseCommit: 'none',
      agent: 'provider',
      selectedProvider: 'provider',
      taskSlug: 'reasoning',
    })
    .run();
  const repository = new SessionEventRepository(db, { publish() {} });
  const projector = new SessionStateProjector('s', db, repository);
  await projector.handleDomainEvent({
    type: 'config_option_update',
    configOptions: [
      {
        id: 'opaque-budget',
        category: 'thought_level',
        name: 'Reasoning',
        type: 'select',
        currentValue: 'thinking',
        options: [
          { value: 'none', name: 'None' },
          { value: 'thinking', name: 'Thinking' },
        ],
      },
    ],
  });
  expect(db.select().from(sessions).get()?.selectedThinkingEffort).toBe('thinking');
  await projector.handleDomainEvent({ type: 'config_option_update', configOptions: [] });
  const row = db.select().from(sessions).get()!;
  expect(row.selectedThinkingEffort).toBeNull();
  expect(JSON.parse(row.sessionConfigOptions)).toEqual([]);
});

function usageFixture() {
  const db = createDatabase(':memory:');
  db.insert(projects).values({ id: 'p', name: 'Project', path: '/tmp' }).run();
  db.insert(sessions)
    .values({
      id: 's',
      projectId: 'p',
      worktreePath: '/tmp',
      branch: 'main',
      baseCommit: 'none',
      agent: 'any-acp',
      selectedProvider: 'any-acp',
      selectedModel: 'a',
      taskSlug: 'usage',
      totalTokens: 1581561,
      sessionMetrics: JSON.stringify({ totalTokens: 1581561, inputTokens: 11785 }),
    })
    .run();
  const repository = new SessionEventRepository(db, { publish() {} });
  return {
    db,
    projector: new SessionStateProjector('s', db, repository),
    row: () => db.select().from(sessions).get()!,
  };
}

test('context updates persist independently of processing totals and allow occupancy to decrease', async () => {
  const { projector, row } = usageFixture();
  for (const used of [161651, 0, 4000]) {
    await projector.handleDomainEvent({ type: 'usage_update', used, size: 200000 });
    expect(row()).toMatchObject({
      contextUsedTokens: used,
      contextLimit: 200000,
      totalTokens: 1581561,
    });
    expect(JSON.parse(row().sessionMetrics)).toMatchObject({
      totalTokens: 1581561,
      inputTokens: 11785,
    });
  }
});

test('replaces session cost snapshots, retains missing reports, and preserves explicit zero with its currency', async () => {
  const { projector, row } = usageFixture();
  const report = (cost?: { amount: number; currency: string }) =>
    projector.handleDomainEvent({ type: 'usage_update', used: 100, size: 200000, cost });
  for (const amount of [0.42, 0.42, 0.5]) {
    await report({ amount, currency: 'EUR' });
    expect(JSON.parse(row().sessionMetrics).reportedCost).toEqual({ amount, currency: 'EUR' });
    expect(row().estimatedCost).toBe(0);
  }
  await report();
  expect(JSON.parse(row().sessionMetrics).reportedCost).toEqual({ amount: 0.5, currency: 'EUR' });
  await report({ amount: 0, currency: 'JPY' });
  await projector.handleDomainEvent({ type: 'metrics_update', metrics: { estimatedCost: 0 } });
  expect(JSON.parse(row().sessionMetrics).reportedCost).toEqual({ amount: 0, currency: 'JPY' });
});

test('rejects non-finite reports and does not borrow an old capacity when the provider reports none', async () => {
  const { projector, row } = usageFixture();
  await projector.handleDomainEvent({ type: 'usage_update', used: Number.NaN, size: 200000 });
  expect(row().contextUsedTokens).toBeNull();
  await projector.handleDomainEvent({
    type: 'usage_update',
    used: 100,
    size: Number.POSITIVE_INFINITY,
  });
  expect(row().contextUsedTokens).toBeNull();
  await projector.handleDomainEvent({ type: 'usage_update', used: 161651, size: 200000 });
  await projector.handleDomainEvent({ type: 'usage_update', used: 100, size: 0 });
  expect(row()).toMatchObject({ contextUsedTokens: 100, contextLimit: 0 });
  expect(JSON.parse(row().sessionMetrics).contextLimit).toBe(0);
});

test('invalidates occupancy for a new turn, compaction, or a different model', async () => {
  const { db, projector, row } = usageFixture();
  const report = () =>
    projector.handleDomainEvent({ type: 'usage_update', used: 161651, size: 200000 });
  await report();
  await projector.startTurn('New question');
  expect(row().contextUsedTokens).toBeNull();
  await report();
  await projector.handleDomainEvent({ type: 'context_compacted', compactionId: 'compact' });
  expect(row().contextUsedTokens).toBeNull();
  await report();
  await projector.handleDomainEvent({
    type: 'config_option_update',
    configOptions: [
      {
        id: 'model',
        category: 'model',
        name: 'Model',
        type: 'select',
        currentValue: 'b',
        options: [{ value: 'b', name: 'B' }],
      },
    ],
  });
  expect(row()).toMatchObject({ contextUsedTokens: null, contextLimit: 0 });
  // Consumption survives all context lifecycle changes.
  expect(
    db.select().from(sessions).where(eq(sessions.id, 's')).get()?.totalTokens,
  ).toBeGreaterThanOrEqual(1581561);
});
