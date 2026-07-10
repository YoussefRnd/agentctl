import { describe, it, expect } from 'vitest';
import { getToolOverride, updateToolOverride } from './McpUtils';

describe('MCP tool overrides helper logic', () => {
  describe('getToolOverride', () => {
    it('should return inherit when JSON is empty, null, or undefined', () => {
      expect(getToolOverride(undefined, 'test_tool')).toBe('inherit');
      expect(getToolOverride(null, 'test_tool')).toBe('inherit');
      expect(getToolOverride('', 'test_tool')).toBe('inherit');
      expect(getToolOverride('{}', 'test_tool')).toBe('inherit');
    });

    it('should return inherit when JSON is invalid', () => {
      expect(getToolOverride('{invalid', 'test_tool')).toBe('inherit');
    });

    it('should return the correct override value when present', () => {
      const json = JSON.stringify({
        test_tool: 'auto_approve',
        other_tool: 'deny',
      });
      expect(getToolOverride(json, 'test_tool')).toBe('auto_approve');
      expect(getToolOverride(json, 'other_tool')).toBe('deny');
      expect(getToolOverride(json, 'missing_tool')).toBe('inherit');
    });

    it('should fall back to inherit if value in JSON is invalid override type', () => {
      const json = JSON.stringify({
        test_tool: 'invalid_value',
      });
      expect(getToolOverride(json, 'test_tool')).toBe('inherit');
    });
  });

  describe('updateToolOverride', () => {
    it('should set override on empty input', () => {
      const result = updateToolOverride('', 'test_tool', 'auto_approve');
      expect(JSON.parse(result)).toEqual({ test_tool: 'auto_approve' });
    });

    it('should update existing overrides', () => {
      const initial = JSON.stringify({ other_tool: 'deny' });
      const result = updateToolOverride(initial, 'test_tool', 'always_prompt');
      expect(JSON.parse(result)).toEqual({
        other_tool: 'deny',
        test_tool: 'always_prompt',
      });
    });

    it('should remove the override if new value is inherit', () => {
      const initial = JSON.stringify({ other_tool: 'deny', test_tool: 'always_prompt' });
      const result = updateToolOverride(initial, 'test_tool', 'inherit');
      expect(JSON.parse(result)).toEqual({
        other_tool: 'deny',
      });
    });

    it('should recover gracefully and set override if initial JSON is invalid', () => {
      const result = updateToolOverride('{invalid_json', 'test_tool', 'deny');
      expect(JSON.parse(result)).toEqual({
        test_tool: 'deny',
      });
    });
  });
});
