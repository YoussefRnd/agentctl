import { expect, test } from 'vitest';
import { acpEvents, mcpServers, providers } from './schema.js';

test('acpEvents schema has parentEventId and metadata', () => {
  expect(acpEvents.parentEventId).toBeDefined();
  expect(acpEvents.metadata).toBeDefined();
});

test('mcpServers schema has approvalPolicy and toolPermissions', () => {
  expect(mcpServers.approvalPolicy).toBeDefined();
  expect(mcpServers.toolPermissions).toBeDefined();
});

test('providers table has the correct redesigned columns', () => {
  expect(providers.installState).toBeDefined();
  expect(providers.authState).toBeDefined();
  expect(providers.hidden).toBeDefined();
  expect('status' in providers).toBe(false);
});
