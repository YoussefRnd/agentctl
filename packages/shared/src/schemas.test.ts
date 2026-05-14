import { describe, it, expect } from 'vitest';
import {
  projectSchema,
  sessionSchema,
  sessionStatusSchema,
  acpEventSchema,
  sessionRowSchema,
  sessionProviderSelectionSchema,
} from './schemas.js';

describe('Shared Schemas', () => {
  describe('projectSchema', () => {
    it('should validate valid project data', () => {
      const validProject = {
        name: 'Test Project',
        path: '/path/to/project',
      };
      expect(projectSchema.parse(validProject)).toEqual(validProject);
    });

    it('should fail validation for empty name', () => {
      const invalidProject = {
        name: '',
        path: '/path/to/project',
      };
      expect(() => projectSchema.parse(invalidProject)).toThrow();
    });

    it('should fail validation for empty path', () => {
      const invalidProject = {
        name: 'Test Project',
        path: '',
      };
      expect(() => projectSchema.parse(invalidProject)).toThrow();
    });

    it('should validate extremely long strings', () => {
      const longString = 'a'.repeat(10000);
      const validProject = {
        name: longString,
        path: longString,
      };
      expect(projectSchema.parse(validProject)).toEqual(validProject);
    });
  });

  describe('sessionSchema', () => {
    it('should validate valid session data', () => {
      const validSession = {
        projectId: '550e8400-e29b-41d4-a716-446655440000',
        branch: 'main',
        agent: 'claude-code',
        taskSlug: 'my-feature-task',
        title: 'my feature task',
        baseCommit: 'abc1234567890',
      };
      expect(sessionSchema.parse(validSession)).toEqual(validSession);
    });

    it('should fail validation if taskSlug is missing', () => {
      const invalidSession = {
        projectId: '550e8400-e29b-41d4-a716-446655440000',
        branch: 'main',
        agent: 'claude-code',
        baseCommit: 'abc1234567890',
      };
      expect(() => sessionSchema.parse(invalidSession)).toThrow();
    });

    it('should fail validation if baseCommit is missing', () => {
      const invalidSession = {
        projectId: '550e8400-e29b-41d4-a716-446655440000',
        branch: 'main',
        agent: 'claude-code',
        taskSlug: 'my-feature-task',
      };
      expect(() => sessionSchema.parse(invalidSession)).toThrow();
    });

    it('should fail validation for invalid agent', () => {
      const invalidSession = {
        projectId: '550e8400-e29b-41d4-a716-446655440000',
        branch: 'main',
        agent: 'unknown-agent',
      };
      expect(() => sessionSchema.parse(invalidSession)).toThrow();
    });

    it('should fail validation for invalid projectId', () => {
      const invalidSession = {
        projectId: 'not-a-uuid',
        branch: 'main',
        agent: 'claude-code',
      };
      expect(() => sessionSchema.parse(invalidSession)).toThrow();
    });
  });

  describe('sessionRowSchema', () => {
    it('should validate provider selection fields on a session row', () => {
      const session = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        projectId: '550e8400-e29b-41d4-a716-446655440001',
        branch: 'main',
        worktreePath: '/tmp/worktree',
        taskSlug: 'my-feature-task',
        title: 'my feature task',
        baseCommit: 'abc1234567890',
        agent: 'claude-code',
        agentSessionId: null,
        status: 'idle',
        totalTokens: 0,
        contextLimit: 128000,
        estimatedCost: 0,
        lastHeartbeat: null,
        closedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        selectedDriver: 'claude-code',
        selectedModel: 'sonnet-4',
        selectedThinkingEffort: 'medium',
      };

      expect(sessionRowSchema.parse(session)).toEqual(session);
    });
  });

  describe('sessionProviderSelectionSchema', () => {
    it('should validate provider selection updates', () => {
      const selection = {
        selectedDriver: 'gemini-cli',
        selectedModel: 'gemini-2.5-pro',
        selectedThinkingEffort: 'high',
      };

      expect(sessionProviderSelectionSchema.parse(selection)).toEqual(selection);
    });
  });

  it('includes title in sessionRowSchema', () => {
    const result = sessionRowSchema.parse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      projectId: '550e8400-e29b-41d4-a716-446655440001',
      branch: 'main',
      taskSlug: 'new-session',
      baseCommit: 'abc123',
      worktreePath: '/tmp/worktree',
      agent: 'claude-code',
      agentSessionId: null,
      status: 'idle',
      totalTokens: 0,
      contextLimit: 128000,
      estimatedCost: 0,
      lastHeartbeat: null,
      closedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      selectedDriver: 'claude-code',
      selectedModel: 'sonnet-4',
      selectedThinkingEffort: 'medium',
      title: 'new session',
    });
    expect(result.title).toBe('new session');
  });

  describe('sessionStatusSchema', () => {
    it('should validate valid statuses', () => {
      expect(sessionStatusSchema.parse('running')).toBe('running');
      expect(sessionStatusSchema.parse('idle')).toBe('idle');
    });

    it('should fail for invalid status', () => {
      expect(() => sessionStatusSchema.parse('invalid')).toThrow();
    });
  });

  describe('acpEventSchema', () => {
    it('should validate valid event', () => {
      const event = {
        type: 'text',
        data: { content: 'hello' },
        createdAt: new Date(),
      };
      expect(acpEventSchema.parse(event)).toEqual(event);
    });

    it('should coerce string date to Date object', () => {
      const now = new Date();
      const event = {
        type: 'status',
        data: 'online',
        createdAt: now.toISOString(),
      };
      const result = acpEventSchema.parse(event);
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.createdAt.getTime()).toBe(now.getTime());
    });

    it('should fail for invalid type', () => {
      const event = {
        type: 'invalid',
        data: {},
        createdAt: new Date(),
      };
      expect(() => acpEventSchema.parse(event)).toThrow();
    });
  });
});
