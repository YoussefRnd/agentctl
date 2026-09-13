import { expect, test } from 'vitest';
import { sessionEvents, mcpServers, providers } from './schema.js';

test('sessionEvents schema has parentEventId and metadata', () => {
  expect(sessionEvents.parentEventId).toBeDefined();
  expect(sessionEvents.metadata).toBeDefined();
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
