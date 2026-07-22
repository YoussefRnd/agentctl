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

  test('expires patterns after maxUses limit', () => {
    const manager = new PermissionPatternManager();
    manager.grantPattern('bash:git status', { maxUses: 2 });

    expect(manager.isToolCallApproved('bash', { command: 'git status' })).toBe(true); // use 1
    expect(manager.isToolCallApproved('bash', { command: 'git status' })).toBe(true); // use 2
    expect(manager.isToolCallApproved('bash', { command: 'git status' })).toBe(false); // expired
  });

  test('exports and imports patterns', () => {
    const manager1 = new PermissionPatternManager();
    manager1.grantPattern('read_file:/src/*', { maxUses: 5 });

    const exported = manager1.exportPatterns();
    expect(exported.grantedPatterns).toHaveLength(1);
    expect(exported.grantedPatterns[0].pattern).toBe('read_file:/src/*');

    const manager2 = new PermissionPatternManager();
    manager2.importPatterns(exported);
    expect(manager2.isToolCallApproved('read_file', { path: '/src/index.ts' })).toBe(true);
  });
});
