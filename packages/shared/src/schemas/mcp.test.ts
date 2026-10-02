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
});
