import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boundaryErrors, dependencyTarget } from './boundaries.mjs';
import { importSpecifiers } from './dependencies.mjs';
test('package direction rejects package, relative, type, lazy, require and re-export bypasses', () => {
  for (const statement of [
    "import type { X } from '../../../apps/web/src/app/App'",
    "export * from '../../../apps/web/src/app/App'",
    "const x = import('../../../apps/web/src/app/App')",
    "const x = require('../../../apps/web/src/app/App')",
    'const x = import(`../../../apps/web/src/app/App`)',
    "type X = import('../../../apps/web/src/app/App').X",
    "import '@agentctl/web'",
  ]) {
    assert.equal(
      boundaryErrors('packages/core/src/test.ts', importSpecifiers(statement)).length,
      1,
      statement,
    );
  }
  assert.equal(boundaryErrors('apps/web/src/App.tsx', ['@agentctl/core/session']).length, 1);
  assert.equal(boundaryErrors('apps/server/src/app.ts', ['@agentctl/ui']).length, 1);
  assert.equal(boundaryErrors('packages/shared/src/model.ts', ['@agentctl/api-client']).length, 1);
  assert.deepEqual(
    boundaryErrors('apps/desktop/src/main/index.ts', [
      '@agentctl/server/app',
      '@agentctl/core/config',
      '@agentctl/shared',
    ]),
    [],
  );
});
test('preload and main communicate through contracts and UI has no product state', () => {
  assert.equal(boundaryErrors('apps/desktop/src/preload/index.ts', ['../main/index']).length, 1);
  assert.equal(boundaryErrors('apps/desktop/src/main/index.ts', ['../preload/index']).length, 1);
  for (const specifier of ['zustand', '@tanstack/react-query', 'node:fs', '@agentctl/shared'])
    assert.ok(boundaryErrors('packages/ui/src/index.ts', [specifier]).length);
  assert.deepEqual(
    boundaryErrors('packages/ui/src/index.ts', ['react', '@radix-ui/react-dialog']),
    [],
  );
});
test('normalizes aliases, relative segments and platform separators and disallows test imports', () => {
  assert.equal(
    dependencyTarget('apps/web/src/app/App.tsx', '@/features/sessions'),
    'apps/web/src/features/sessions',
  );
  assert.equal(
    dependencyTarget('packages/core/src/agent/start.ts', '.././../src/acp/driver.js'),
    'packages/core/src/acp/driver.js',
  );
  assert.equal(
    dependencyTarget('apps\\desktop\\src\\preload\\index.ts', '../main/index'),
    'apps/desktop/src/main/index',
  );
  assert.equal(boundaryErrors('packages/ui/src/index.ts', ['./accessibility.test.tsx']).length, 1);
});
