import { describe, it, expect } from 'vitest';
import { mcpServerSchema } from '../api-contract.js';

describe('mcpServerSchema', () => {
  const baseServer = {
    id: 'test-server',
    name: 'Test Server',
    command: 'node',
    launchArgs: '--version',
    launchEnv: '{}',
    enabled: true,
    autoApprove: false,
    type: 'local' as const,
    url: null,
    headers: null,
    status: 'connected' as const,
    error: null,
  };

  it('should parse valid schema and supply defaults for approvalPolicy and toolPermissions', () => {
    const result = mcpServerSchema.safeParse(baseServer);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.approvalPolicy).toBe('always_prompt');
      expect(result.data.toolPermissions).toBe('{}');
    }
  });

  it('should parse explicit values for approvalPolicy and toolPermissions', () => {
    const result = mcpServerSchema.safeParse({
      ...baseServer,
      approvalPolicy: 'deny_all',
      toolPermissions: '{"some-tool": "allow"}',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.approvalPolicy).toBe('deny_all');
      expect(result.data.toolPermissions).toBe('{"some-tool": "allow"}');
    }
  });

  it('should reject invalid approvalPolicy values', () => {
    const result = mcpServerSchema.safeParse({
      ...baseServer,
      approvalPolicy: 'invalid_policy',
    });
    expect(result.success).toBe(false);
  });
});
