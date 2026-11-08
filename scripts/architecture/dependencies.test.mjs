import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, dependencies } from './fixtures.mjs';

test('dependency-cruiser detects workspace module cycles including type-only dependencies', async () => {
  await fixture(async ({ root, write }) => {
    for (const area of ['packages/shared/src', 'packages/core/src/acp']) {
      await write(`${area}/a.ts`, "export type { B } from './b.js'; export type A = string;");
      await write(`${area}/b.ts`, "export type { C } from './c.js'; export type B = string;");
      await write(`${area}/c.ts`, "export type { A } from './a.js'; export type C = string;");
    }
    const graph = await dependencies(root);
    const cycles = graph.summary.violations.filter(
      (item) => item.rule.name === 'workspace-modules-no-cycles',
    );
    assert.equal(cycles.length, 2);
    assert.ok(cycles.some((item) => item.from.startsWith('packages/shared/src/')));
    assert.ok(cycles.some((item) => item.from.startsWith('packages/core/src/acp/')));
  });
});

test('feature-folder cycles are detected without a module cycle and exclude test-only edges', async () => {
  await fixture(async ({ root, write, publicApi }) => {
    publicApi.features = ['alpha', 'beta', 'gamma'].map((feature) => ({
      feature,
      entries: ['index'],
    }));
    await write('docs/public-api.json', publicApi);
    for (const { feature } of publicApi.features)
      await write(`apps/web/src/features/${feature}/index.ts`, 'export const value = 1;');
    const edges = [
      ['alpha', 'beta'],
      ['beta', 'gamma'],
      ['gamma', 'alpha'],
    ];
    for (const [from, to] of edges)
      await write(
        `apps/web/src/features/${from}/cycle.test.ts`,
        `export * from '@/features/${to}';`,
      );
    const clean = await dependencies(root);
    assert.equal(clean.exitCode, 0, JSON.stringify(clean.summary.violations));
    for (const [from, to] of edges)
      await write(
        `apps/web/src/features/${from}/independent.ts`,
        `export * from '@/features/${to}';`,
      );
    const cyclic = await dependencies(root);
    assert.equal(cyclic.exitCode, 1);
    assert.ok(
      cyclic.summary.violations.some((item) => item.rule.name === 'features-no-folder-cycles'),
    );
    assert.ok(
      cyclic.modules.every((module) => module.dependencies.every((edge) => !edge.circular)),
    );
  });
});

test('shared and feature composition rules cannot be bypassed through aliases or relatives', async () => {
  await fixture(async ({ root, write, publicApi }) => {
    publicApi.features = ['sessions', 'composer', 'review'].map((feature) => ({
      feature,
      entries: ['index'],
    }));
    await write('docs/public-api.json', publicApi);
    for (const { feature } of publicApi.features)
      await write(`apps/web/src/features/${feature}/index.ts`, 'export const value = 1;');
    await write('apps/web/src/app/composition.ts', 'export const app = true;');
    await write('apps/web/src/shared/invalid.ts', "export * from '@/features/review';");
    await write(
      'apps/web/src/features/sessions/invalid.ts',
      "export * from '../composer/index.js';",
    );
    await write(
      'apps/web/src/features/composer/invalid.ts',
      "export * from '@/features/review'; export * from '@/app/composition';",
    );
    await write('apps/web/src/features/review/invalid.ts', "export * from '../composer/index.js';");
    const graph = await dependencies(root);
    for (const rule of [
      'web-shared-direction',
      'web-sessions-direction',
      'web-composer-direction',
      'web-review-direction',
      'web-features-not-composition',
    ])
      assert.ok(
        graph.summary.violations.some((item) => item.rule.name === rule),
        rule,
      );
  });
});
