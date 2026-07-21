import { describe, test, expect } from 'vitest';
import { PermissionPatternManager } from './permission-pattern-manager.js';

describe('PermissionPatternManager', () => {
  test('generates rich permission options with sub-patterns', () => {
    const manager = new PermissionPatternManager();
    const options = manager.buildPermissionOptions('terminal', { command: 'git status' });

    expect(options.type).toBe('dropdown_with_patterns');
    if (options.type === 'dropdown_with_patterns') {
      expect(options.choices).toHaveLength(2);
      expect(options.patterns[0].pattern).toBe('terminal:git status');
      expect(options.patterns[1].pattern).toBe('terminal:git *');
    }
  });

  test('auto-approves tool calls matching granted patterns', () => {
    const manager = new PermissionPatternManager();
    expect(manager.isToolCallApproved('terminal', { command: 'git diff' })).toBe(false);

    manager.grantPattern('terminal:git *');
    expect(manager.isToolCallApproved('terminal', { command: 'git diff' })).toBe(true);
    expect(manager.isToolCallApproved('terminal', { command: 'npm start' })).toBe(false);
  });
});
