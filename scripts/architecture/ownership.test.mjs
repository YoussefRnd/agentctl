import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ownershipErrors } from './ownership.mjs';

test('core coverage rejects missing, stale and duplicate module ownership', () => {
  const area = {
    owner: 'context indexing',
    evidence: 'context-architecture.md',
    files: ['index.ts'],
  };
  assert.deepEqual(ownershipErrors(['index.ts'], [area]), []);
  assert.deepEqual(ownershipErrors(['index.ts', 'new.ts'], [area]), [
    'Core file needs an owner and acceptance evidence: new.ts',
  ]);
  assert.deepEqual(ownershipErrors([], [area]), ['Remove stale core ownership entry: index.ts']);
  assert.deepEqual(ownershipErrors(['index.ts'], [area, area]), ['Duplicate core owner: index.ts']);
  assert.deepEqual(ownershipErrors([], [{ owner: '', evidence: '', files: [] }]), [
    'Core ownership area requires an owner and evidence',
  ]);
});
