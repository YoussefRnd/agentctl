import { describe, it, expect } from 'vitest';
import { acpEventSchema, acpEventSubagentUpdateDataSchema } from './acp.js';

describe('acpEventSubagentUpdateDataSchema', () => {
  it('should parse a valid subagent_update data object', () => {
    const data = {
      subagentId: 'sa_abc123',
      name: 'explore',
      scope: 'Search for auth middleware patterns',
      status: 'running',
    };
    const result = acpEventSubagentUpdateDataSchema.parse(data);
    expect(result.subagentId).toBe('sa_abc123');
    expect(result.name).toBe('explore');
    expect(result.status).toBe('running');
  });

  it('should parse with optional result', () => {
    const data = {
      subagentId: 'sa_abc123',
      name: 'builder',
      scope: 'Implement login form',
      status: 'completed',
      result: { summary: 'Done', tokensUsed: 142 },
    };
    const result = acpEventSubagentUpdateDataSchema.parse(data);
    expect(result.result?.summary).toBe('Done');
    expect(result.result?.tokensUsed).toBe(142);
  });

  it('should reject invalid status', () => {
    const data = {
      subagentId: 'sa_abc123',
      name: 'explore',
      scope: 'test',
      status: 'unknown',
    };
    expect(() => acpEventSubagentUpdateDataSchema.parse(data)).toThrow();
  });

  it('should reject missing required fields', () => {
    const data = { subagentId: 'sa_abc123' };
    expect(() => acpEventSubagentUpdateDataSchema.parse(data)).toThrow();
  });
});

describe('acpEventSchema (subagent_update variant)', () => {
  it('should parse a full subagent_update event', () => {
    const event = {
      type: 'subagent_update',
      data: {
        subagentId: 'sa_abc123',
        name: 'explore',
        scope: 'Research codebase',
        status: 'running',
      },
      createdAt: '2026-07-08T00:00:00Z',
    };
    const result = acpEventSchema.parse(event);
    expect(result.type).toBe('subagent_update');
  });
});
