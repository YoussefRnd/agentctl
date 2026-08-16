import { describe, test, expect } from 'vitest';
import { PermissionEngine } from './permission-engine.js';
import type { RequestPermissionRequest } from '@agentclientprotocol/sdk';

describe('PermissionEngine', () => {
  test('generates rich permission options with sub-patterns', () => {
    const engine = new PermissionEngine();
    const options = engine.buildPermissionOptions('terminal', { command: 'git status' });

    expect(options.type).toBe('dropdown_with_patterns');
    if (options.type === 'dropdown_with_patterns') {
      expect(options.choices).toHaveLength(2);
      expect(options.patterns[0].pattern).toBe('terminal:git status');
      expect(options.patterns[1].pattern).toBe('terminal:git *');
    }
  });

  test('auto-approves tool calls matching granted patterns', () => {
    const engine = new PermissionEngine();
    expect(engine.isToolCallApproved('terminal', { command: 'git diff' })).toBe(false);

    engine.grantPattern('terminal:git *');
    expect(engine.isToolCallApproved('terminal', { command: 'git diff' })).toBe(true);
    expect(engine.isToolCallApproved('terminal', { command: 'npm start' })).toBe(false);
  });

  test('expires patterns after maxUses limit', () => {
    const engine = new PermissionEngine();
    engine.grantPattern('bash:git status', { maxUses: 2 });

    expect(engine.isToolCallApproved('bash', { command: 'git status' })).toBe(true); // use 1
    expect(engine.isToolCallApproved('bash', { command: 'git status' })).toBe(true); // use 2
    expect(engine.isToolCallApproved('bash', { command: 'git status' })).toBe(false); // expired
  });

  test('does not consume grants when one request target is denied', () => {
    const engine = new PermissionEngine();
    engine.grantPattern('tool:/allowed', { maxUses: 1 });

    expect(engine.isToolCallApproved('tool', { path: '/allowed', command: 'denied' })).toBe(false);
    expect(engine.isToolCallApproved('tool', { path: '/allowed' })).toBe(true);
  });

  test('counts one approved tool call as one grant use', () => {
    const engine = new PermissionEngine();
    engine.grantPattern('tool:*', { maxUses: 1 });

    expect(engine.isToolCallApproved('tool', { path: '/a', command: 'echo ok' })).toBe(true);
    expect(engine.isToolCallApproved('tool', { path: '/b' })).toBe(false);
  });

  test('exports and imports state', () => {
    const engine1 = new PermissionEngine();
    engine1.grantPattern('read_file:/src/*', { maxUses: 5 });

    const exported = engine1.exportState();
    expect(exported.grantedPatterns).toHaveLength(1);
    expect(exported.grantedPatterns[0].pattern).toBe('read_file:/src/*');

    const engine2 = new PermissionEngine();
    engine2.importState(exported);
    expect(engine2.isToolCallApproved('read_file', { path: '/src/index.ts' })).toBe(true);
  });

  test('evaluates ACP request and auto-approves when pattern matches', () => {
    const engine = new PermissionEngine([{ pattern: 'terminal:git status' }]);

    const sdkRequest = {
      toolCall: {
        toolCallId: 't123',
        title: 'Terminal',
        rawInput: { name: 'terminal', arguments: { command: 'git status' } },
      },
      options: [
        { optionId: 'allow_once', name: 'Allow Once' },
        { optionId: 'allow_always', name: 'Allow Always' },
      ],
    } as unknown as RequestPermissionRequest;

    const evalResult = engine.evaluateRequest(sdkRequest);
    expect(evalResult.autoApproved).toBe(true);
    expect(evalResult.response?.outcome.outcome).toBe('selected');
  });

  test('evaluates ACP request and returns UI options when no pattern matches', () => {
    const engine = new PermissionEngine();

    const sdkRequest = {
      toolCall: {
        toolCallId: 't456',
        title: 'Terminal',
        rawInput: { name: 'terminal', arguments: { command: 'git commit' } },
      },
      options: [{ optionId: 'allow_once', name: 'Allow Once' }],
    } as unknown as RequestPermissionRequest;

    const evalResult = engine.evaluateRequest(sdkRequest);
    expect(evalResult.autoApproved).toBe(false);
    expect(evalResult.uiOptions?.type).toBe('dropdown_with_patterns');
  });

  test('resolves outcome and grants new pattern on allow_always', () => {
    const engine = new PermissionEngine();

    const response = engine.resolveOutcome('perm1', 'allow_always', {
      patterns: ['terminal:git *'],
    });

    expect(response.outcome.outcome).toBe('selected');
    expect(engine.isToolCallApproved('terminal', { command: 'git status' })).toBe(true);
  });
});
