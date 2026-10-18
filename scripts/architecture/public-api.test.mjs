import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, dependencies } from './fixtures.mjs';

test('declared source entries resolve before a build; private entries and relative source bypasses fail', async () => {
  await fixture(async ({ root, write }) => {
    await write('packages/shared/src/private.ts', 'export const value = 1;');
    await write('apps/web/src/valid.ts', "export * from '@agentctl/shared';");
    assert.equal((await dependencies(root)).exitCode, 0);
    await write('apps/web/src/private.ts', "export * from '@agentctl/shared/src/private';");
    await write(
      'apps/web/src/relative.ts',
      "export * from '../../../packages/shared/src/private.js';",
    );
    const graph = await dependencies(root);
    for (const rule of ['no-unresolved-internal-imports', 'public-entry-shared'])
      assert.ok(
        graph.summary.violations.some((item) => item.rule.name === rule),
        rule,
      );
  });
});

test('feature public entries apply to aliases, relative paths and tests, without matching comments or text', async () => {
  await fixture(async ({ root, write, publicApi }) => {
    publicApi.features = [{ feature: 'alpha', entries: ['index', 'gallery'] }];
    await write('docs/public-api.json', publicApi);
    await write('apps/web/src/features/alpha/index.ts', 'export const value = 1;');
    await write('apps/web/src/features/alpha/gallery.tsx', 'export const gallery = true;');
    await write('apps/web/src/features/alpha/model.ts', 'export const privateValue = true;');
    await write(
      'apps/web/src/app/valid.ts',
      `
      export * from '@/features/alpha';
      export * from '../features/alpha/gallery.js';
      // import '@/features/alpha/model';
      const text = "from '@/features/alpha/model'";
    `,
    );
    assert.equal((await dependencies(root)).exitCode, 0);
    await write('apps/web/src/app/alias.test.ts', "export * from '@/features/alpha/model';");
    await write('apps/web/src/app/relative.ts', "export * from '../features/alpha/model.js';");
    const graph = await dependencies(root);
    assert.equal(
      graph.summary.violations.filter((item) => item.rule.name === 'feature-public-entry-alpha')
        .length,
      2,
    );
  });
});
