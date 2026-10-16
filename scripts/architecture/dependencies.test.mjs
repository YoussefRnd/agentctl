import assert from 'node:assert/strict';
import { test } from 'node:test';
import { importSpecifiers, cycleEdges, cycleBaselineErrors } from './dependencies.mjs';

test('reads static, re-exported, lazy, and type dependencies without matching comments or text', () => {
  assert.deepEqual(
    importSpecifiers(`
    // import { imaginary } from 'comment';
    const message = "from 'text'";
    import type { Session } from 'contracts';
    export { Widget } from 'widgets';
    const lazy = () => import('review');
    type Result = import('results').Result;
  `),
    ['contracts', 'widgets', 'review', 'results'],
  );
});

test('finds multi-hop cycles while leaving one-way dependencies independent', () => {
  const graph = new Map([
    ['composer', new Set(['review'])],
    ['review', new Set(['sessions'])],
    ['sessions', new Set(['composer', 'providers'])],
    ['providers', new Set()],
  ]);
  assert.deepEqual(cycleEdges(graph), [
    'composer -> review',
    'review -> sessions',
    'sessions -> composer',
  ]);
});

test('rejects new cycles and forces removal of resolved exceptions', () => {
  assert.deepEqual(cycleBaselineErrors(['a -> b'], { 'a -> b': 'migration' }), []);
  assert.deepEqual(cycleBaselineErrors(['a -> b'], {}), ['New cyclic dependency: a -> b']);
  assert.deepEqual(cycleBaselineErrors([], { 'a -> b': 'migration' }), [
    'Remove resolved cycle from the baseline: a -> b',
  ]);
});

test('distinguishes module initialization from deferred factory calls', async () => {
  const { topLevelCalls } = await import('./dependencies.mjs');
  assert.deepEqual(
    topLevelCalls(`
    const eager = createDatabase();
    const explicit = () => getDefaultDatabase();
    function factory() { return new DatabaseSync(); }
    class Runtime { start() { return loadWorkspaceEnv(); } }
  `),
    ['createDatabase'],
  );
});
