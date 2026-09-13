import { describe, it, expect } from 'vitest';
import { sessionEventSchema, sessionEventSubagentUpdateDataSchema } from './session-event.js';

describe('sessionEventSubagentUpdateDataSchema', () => {
  it('should parse a valid subagent_update data object', () => {
    const data = {
      subagentId: 'sa_abc123',
      name: 'explore',
      scope: 'Search for auth middleware patterns',
      status: 'running',
    };
    const result = sessionEventSubagentUpdateDataSchema.parse(data);
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
    const result = sessionEventSubagentUpdateDataSchema.parse(data);
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
    expect(() => sessionEventSubagentUpdateDataSchema.parse(data)).toThrow();
  });

  it('should reject missing required fields', () => {
    const data = { subagentId: 'sa_abc123' };
    expect(() => sessionEventSubagentUpdateDataSchema.parse(data)).toThrow();
  });
});

describe('sessionEventSchema (subagent_update variant)', () => {
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
    const result = sessionEventSchema.parse(event);
    expect(result.type).toBe('subagent_update');
  });
});
