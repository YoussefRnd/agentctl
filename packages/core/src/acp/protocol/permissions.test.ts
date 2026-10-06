import { expect, test } from 'vitest';
import { parsePermissionRequest, formatPermissionOutcome } from './permissions.js';
import { toPermissionRequest } from '../v2/runtime.js';
import { getBestPermissionOption } from '../../security/permission-options.js';

test('v1 keeps every structured path and raw input without turning a title into a path', () => {
  const request = parsePermissionRequest({
    sessionId: 's',
    toolCall: {
      toolCallId: 't',
      title: 'Edit two files',
      kind: 'edit',
      locations: [{ path: '/project/a' }, { path: '/project/b' }],
      rawInput: { arguments: { content: 'hello' } },
    },
    options: [],
  });
  expect(request.toolCall).toMatchObject({
    kind: 'edit',
    locations: [
      { path: '/project/a', line: undefined },
      { path: '/project/b', line: undefined },
    ],
    arguments: { content: 'hello' },
  });
  const unknown = parsePermissionRequest({
    sessionId: 's',
    toolCall: { toolCallId: 'unknown', title: '/looks/like/a/path' },
    options: [],
  });
  expect(unknown.toolCall.arguments).toBeUndefined();
  expect(unknown.toolCall.locations).toBeUndefined();
});
test('v2 preserves unfamiliar subjects without classifying them as commands', () => {
  const subject = { type: '_future_operation' as const, payload: { value: 42 } };
  const request = toPermissionRequest(
    {
      sessionId: 's',
      title: 'Future request',
      subject,
      options: [{ optionId: 'once', name: 'Allow', kind: 'allow_once' }],
    },
    'permission',
  );
  expect(request.subject).toEqual(subject);
  expect(request.toolCall).toEqual({ name: 'Future request', kind: 'other' });
});
test('v2 commands preserve their working directory and tool-call subjects preserve action metadata', () => {
  expect(
    toPermissionRequest(
      {
        sessionId: 's',
        title: 'Run command',
        subject: { type: 'command', command: 'git status', cwd: '/project' },
        options: [{ optionId: 'once', name: 'Allow', kind: 'allow_once' }],
      },
      'p',
    ).toolCall,
  ).toMatchObject({ kind: 'execute', arguments: { command: 'git status', cwd: '/project' } });
  expect(
    toPermissionRequest(
      {
        sessionId: 's',
        title: 'Edit',
        subject: {
          type: 'tool_call',
          toolCall: {
            toolCallId: 't',
            kind: 'edit',
            locations: [{ path: '/project/file' }],
            rawInput: { arguments: { content: 'new' } },
          },
        },
        options: [{ optionId: 'once', name: 'Allow', kind: 'allow_once' }],
      },
      'p',
    ).toolCall,
  ).toMatchObject({
    kind: 'edit',
    locations: [{ path: '/project/file' }],
    arguments: { content: 'new' },
  });
});
test('automatic choices use advertised once kinds and never infer permission from labels', () => {
  expect(
    getBestPermissionOption([
      { optionId: 'always', kind: 'allow_always' },
      { optionId: 'opaque', kind: 'allow_once' },
    ]),
  ).toBe('opaque');
  expect(getBestPermissionOption([{ optionId: 'always', kind: 'allow_always' }])).toBeUndefined();
  expect(
    getBestPermissionOption([{ optionId: 'not-safe', label: 'Approve this permanently' }]),
  ).toBeUndefined();
});
test('cancellation stays cancelled even when a reject option is advertised', () => {
  expect(
    formatPermissionOutcome({ allowed: false, cancelled: true }, [
      { optionId: 'reject', kind: 'reject_once' },
    ]),
  ).toEqual({ outcome: { outcome: 'cancelled' } });
});

test('opaque tool-call IDs are not interpreted as MCP tool names', () => {
  const request = parsePermissionRequest({
    sessionId: 's',
    toolCall: { toolCallId: 'server__tool', title: 'Unknown request' },
    options: [],
  });
  expect(request.toolCall.name).toBe('Unknown request');
});

test('never returns an option ID absent from the provider request', () => {
  expect(
    formatPermissionOutcome({ allowed: true, optionId: 'fabricated' }, [
      { optionId: 'offered', kind: 'allow_once' },
    ]),
  ).toEqual({ outcome: { outcome: 'cancelled' } });
});
