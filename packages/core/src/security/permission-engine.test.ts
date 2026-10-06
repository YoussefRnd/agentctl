import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { PermissionEngine, type PermissionPolicy } from './permission-engine.js';
import type { AgentPermissionRequest } from '../agent/types.js';

let root: string;
let policy: PermissionPolicy;
let engine: PermissionEngine;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentctl-policy-'));
  policy = { mode: 'auto_approve', cwd: root };
  engine = new PermissionEngine();
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
function edit(paths = [path.join(root, 'file.ts')]): AgentPermissionRequest {
  return {
    permissionId: 'edit',
    source: 'provider',
    toolCall: {
      name: 'arbitrary_tool_name',
      kind: 'edit',
      locations: paths.map((file) => ({ path: file })),
      arguments: { path: paths[0], content: 'hello' },
    },
    options: [
      { optionId: 'once', kind: 'allow_once' },
      { optionId: 'always', kind: 'allow_always' },
    ],
  };
}
function command(value = 'git', args = ['status']): AgentPermissionRequest {
  return {
    permissionId: 'command',
    source: 'provider',
    toolCall: { name: 'shell', kind: 'execute', arguments: { command: value, args, cwd: root } },
    options: [{ optionId: 'once', kind: 'allow_once' }],
  };
}

test('workspace edits use structured kinds and paths, not provider tool names', () => {
  expect(engine.evaluate(edit(), policy)).toBe('allow');
  const misleading = command();
  misleading.toolCall.name = 'fs/safe';
  expect(engine.evaluate(misleading, policy)).toBe('ask');
});
test.each(['read', 'search', 'execute', 'fetch', 'other', '_future', undefined])(
  'asks about %s requests in workspace-edit mode',
  (kind) => {
    const request = edit();
    request.toolCall.kind = kind;
    expect(engine.evaluate(request, policy)).toBe('ask');
  },
);
test('every affected location must be present and within the workspace', () => {
  expect(engine.evaluate(edit([]), policy)).toBe('ask');
  expect(engine.evaluate(edit([path.join(root, 'file.ts'), '/outside/file.ts']), policy)).toBe(
    'ask',
  );
  const request = edit();
  request.toolCall.locations!.push({});
  expect(engine.evaluate(request, policy)).toBe('ask');
});
test('symlink traversal cannot make outside edits appear to be workspace edits', () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'agentctl-policy-outside-'));
  try {
    fs.mkdirSync(path.join(outside, 'nested'));
    fs.symlinkSync(path.join(outside, 'nested'), path.join(root, 'link'));
    expect(engine.evaluate(edit([`${root}/link/../new.ts`]), policy)).toBe('ask');
    fs.symlinkSync(path.join(outside, 'missing'), path.join(root, 'broken'));
    expect(engine.evaluate(edit([`${root}/broken/new.ts`]), policy)).toBe('ask');
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
test('explicit deny wins over automatic approval and remembered choices', () => {
  const request = edit();
  engine.recordDecision(request, policy, true, true);
  expect(engine.evaluate(request, { ...policy, mode: 'yolo', toolPolicy: 'deny' })).toBe('deny');
});
test('explicit ask rules still prompt in auto-approve requests mode', () => {
  expect(engine.evaluate(edit(), { ...policy, mode: 'yolo', toolPolicy: 'always_prompt' })).toBe(
    'ask',
  );
});
test('an automatic approval never chooses a persistent-only provider option', () => {
  const request = edit();
  request.options = [{ optionId: 'opaque', kind: 'allow_always' }];
  expect(engine.evaluate(request, { ...policy, mode: 'yolo' })).toBe('ask');
});
test('remembering an action does not authorize a sibling file or changed content', () => {
  const request = edit();
  engine.recordDecision(request, policy, true, true);
  const review = { ...policy, mode: 'review' as const };
  expect(engine.evaluate(request, review)).toBe('allow');
  expect(engine.evaluate(edit([path.join(root, 'sibling.ts')]), review)).toBe('ask');
  const changed = edit();
  changed.toolCall.arguments!.content = 'different';
  expect(engine.evaluate(changed, review)).toBe('ask');
});
test('remembering a command does not authorize a command prefix or different environment', () => {
  engine.recordDecision(command(), policy, true, true);
  expect(engine.evaluate(command('git', ['push']), { ...policy, mode: 'review' })).toBe('ask');
  const changed = command();
  changed.toolCall.arguments!.env = { CONFIG: 'other' };
  expect(engine.evaluate(changed, { ...policy, mode: 'review' })).toBe('ask');
});
test('a native approval covers one exact client operation and clears at turn end', () => {
  const request = edit();
  const client = {
    ...request,
    source: 'client' as const,
    toolCall: { ...request.toolCall, name: 'fs/write_text_file' },
  };
  const review = { ...policy, mode: 'review' as const };
  engine.recordDecision(request, policy, true, true);
  expect(engine.evaluate(client, review)).toBe('allow');
  expect(engine.evaluate(client, review)).toBe('ask');
  engine.recordDecision(request, policy, true, false);
  engine.clearTurn();
  expect(engine.evaluate(client, review)).toBe('ask');
});
test('exact client denies remain effective even in auto-approve requests mode', () => {
  const request = { ...edit(), source: 'client' as const };
  engine.recordDecision(request, policy, false, true);
  expect(engine.evaluate(request, { ...policy, mode: 'yolo' })).toBe('deny');
});
test('configured MCP auto-approval applies in workspace-edit mode, not ask-every-time mode', () => {
  expect(engine.evaluate(command(), { ...policy, toolPolicy: 'auto_approve' })).toBe('allow');
  expect(
    engine.evaluate(command(), { ...policy, mode: 'review', toolPolicy: 'auto_approve' }),
  ).toBe('ask');
});

test('remembered actions distinguish primitive input and extra nested input metadata', () => {
  const request = edit();
  request.toolCall.rawInput = 'first edit';
  engine.recordDecision(request, policy, true, true);
  const changed = edit();
  changed.toolCall.rawInput = 'different edit';
  expect(engine.evaluate(changed, { ...policy, mode: 'review' })).toBe('ask');
  request.toolCall.rawInput = { arguments: request.toolCall.arguments, operation: 'first' };
  engine.recordDecision(request, policy, true, true);
  changed.toolCall.rawInput = { arguments: changed.toolCall.arguments, operation: 'other' };
  expect(engine.evaluate(changed, { ...policy, mode: 'review' })).toBe('ask');
});

test('a remembered provider deny also blocks a matching client action', () => {
  const request = edit();
  engine.recordDecision(request, policy, false, true);
  expect(engine.evaluate({ ...request, source: 'client' }, { ...policy, mode: 'yolo' })).toBe(
    'deny',
  );
});
