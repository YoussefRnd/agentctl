import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicImportErrors } from './public-api.mjs';
const surfaces = [
  { package: '@agentctl/shared', root: 'packages/shared', entries: ['.', './schemas', './types'] },
];
test('rejects undeclared package entries and relative source bypasses while retaining named APIs', () => {
  assert.deepEqual(
    publicImportErrors(
      'apps/web/src/main.ts',
      ['@agentctl/shared', '@agentctl/shared/schemas'],
      surfaces,
    ),
    [],
  );
  assert.equal(
    publicImportErrors('apps/web/src/main.ts', ['@agentctl/shared/src/utils'], surfaces).length,
    1,
  );
  assert.equal(
    publicImportErrors('apps/web/src/main.ts', ['../../../packages/shared/src/utils'], surfaces)
      .length,
    1,
  );
  assert.deepEqual(
    publicImportErrors('packages/shared/src/schemas/plan.ts', ['../utils.js'], surfaces),
    [],
  );
});
