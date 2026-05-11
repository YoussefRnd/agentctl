import { describe, it, expect } from 'vitest';
import { projectSchema, sessionSchema, sessionStatusSchema, acpEventSchema } from './schemas.js';

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
