import { expect, test } from 'vitest';
import { acpEvents } from './schema.js';

test('acpEvents schema has parentEventId and metadata', () => {
  expect(acpEvents.parentEventId).toBeDefined();
  expect(acpEvents.metadata).toBeDefined();
});
