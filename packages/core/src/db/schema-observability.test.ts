import { expect, test } from 'vitest';
import { acpEvents, mcpServers } from './schema.js';

test('acpEvents schema has parentEventId and metadata', () => {
  expect(acpEvents.parentEventId).toBeDefined();
  expect(acpEvents.metadata).toBeDefined();
});

test('mcpServers schema has approvalPolicy and toolPermissions', () => {
  expect(mcpServers.approvalPolicy).toBeDefined();
  expect(mcpServers.toolPermissions).toBeDefined();
});

