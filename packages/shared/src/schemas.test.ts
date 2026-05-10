import { describe, it, expect } from 'vitest';
import { projectSchema, sessionSchema } from './schemas.js';

describe('Shared Schemas', () => {
  describe('projectSchema', () => {
    it('should validate valid project data', () => {
      const validProject = {
        name: 'Test Project',
        path: '/path/to/project',
      };
      expect(projectSchema.parse(validProject)).toEqual(validProject);
    });

    it('should fail validation for invalid project data', () => {
      const invalidProject = {
        name: '', // Too short
        path: '/path/to/project',
      };
      expect(() => projectSchema.parse(invalidProject)).toThrow();
    });
  });

  describe('sessionSchema', () => {
    it('should validate valid session data', () => {
      const validSession = {
        projectId: '550e8400-e29b-41d4-a716-446655440000',
        branch: 'main',
        agent: 'claude-code',
      };
      expect(sessionSchema.parse(validSession)).toEqual(validSession);
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
});
