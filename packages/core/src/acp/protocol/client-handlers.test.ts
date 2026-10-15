import { CLIENT_METHODS, type Client } from '@agentclientprotocol/sdk';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import type { AgentSessionCallbacks } from '../../agent/types.js';
import { noopLogger } from '../../logger.js';
import { createClientHandlers } from './client-handlers.js';
import { TerminalManager } from './terminal-manager.js';

function makeContext(cwd: string) {
  const onUpdate = () => Promise.resolve();
  const callbacks = {
    onUpdate,
    onRequestPermission: () => Promise.resolve({ allowed: false }),
  } as unknown as AgentSessionCallbacks;
  return {
    cwd: process.cwd(),
    terminalManager: new TerminalManager(noopLogger),
    logger: noopLogger,
    resolveSession: () => ({ callbacks, cwd }),
  };
}

function requiredHandlers(cwd: string): Required<Client> {
  return createClientHandlers(makeContext(cwd)) as unknown as Required<Client>;
}

describe('createClientHandlers', () => {
  test('exposes every method the SDK dispatches on the Client interface', () => {
    const handlers = createClientHandlers(makeContext(os.tmpdir()));

    // The SDK request handler switch (acp.js) dispatches these camelCase
    // keys. Keys below MUST stay in sync with the SDK dispatch table.
    // Lifecycle helpers are internal; connectAcpClient registers only SDK methods.
    expect(
      Object.keys(handlers)
        .filter((key) => key !== 'releaseSession' && key !== 'dispose')
        .sort(),
    ).toEqual(
      [
        'sessionUpdate',
        'requestPermission',
        'readTextFile',
        'writeTextFile',
        'createTerminal',
        'terminalOutput',
        'releaseTerminal',
        'waitForTerminalExit',
        'killTerminal',
        'createElicitation',
        'completeElicitation',
        'extMethod',
        'extNotification',
      ].sort(),
    );

    // Every canonical client method is distinct in the SDK dispatch table.
    const sdkDispatchKeys = new Set(Object.values(CLIENT_METHODS));
    expect(sdkDispatchKeys.size).toBe(Object.keys(CLIENT_METHODS).length);
    expect(Object.keys(handlers)).toContain('readTextFile');
    expect(Object.keys(handlers)).toContain('writeTextFile');
    expect(Object.keys(handlers)).toContain('createTerminal');
  });

  test('readTextFile reads an absolute path within the session cwd', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentctl-handlers-'));
    const file = path.join(dir, 'hello.txt');
    fs.writeFileSync(file, 'line one\nline two\nline three\n');
    const handlers = requiredHandlers(dir);

    const res = await handlers.readTextFile({ sessionId: 's', path: file });
    expect(res.content).toContain('line one');
  });

  test('readTextFile rejects paths outside the session cwd', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentctl-handlers-'));
    const handlers = requiredHandlers(dir);

    await expect(handlers.readTextFile({ sessionId: 's', path: '/etc/passwd' })).rejects.toThrow();
  });

  test('writeTextFile rejects paths outside the session cwd', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentctl-handlers-'));
    const handlers = requiredHandlers(dir);

    await expect(
      handlers.writeTextFile({
        sessionId: 's',
        path: '/tmp/agentctl-escape-test-xyz/evil.txt',
        content: 'nope',
      }),
    ).rejects.toThrow();
  });

  test('requestPermission delegates to the resolved session callbacks', async () => {
    const callbacks = {
      onUpdate: () => Promise.resolve(),
      onRequestPermission: () => Promise.resolve({ allowed: true, optionId: 'allow-once' }),
    } as unknown as AgentSessionCallbacks;
    const handlers = createClientHandlers({
      cwd: process.cwd(),
      terminalManager: new TerminalManager(noopLogger),
      logger: noopLogger,
      resolveSession: () => ({ callbacks, cwd: process.cwd() }),
    });

    const res = await handlers.requestPermission({
      sessionId: 's',
      toolCall: { toolCallId: 't1', title: 'Test tool' },
      options: [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }],
    });
    expect(res.outcome).toEqual({ outcome: 'selected', optionId: 'allow-once' });
  });

  test('requestPermission selects the advertised reject option when denied', async () => {
    const handlers = requiredHandlers(process.cwd());
    const res = await handlers.requestPermission({
      sessionId: 's',
      toolCall: { toolCallId: 't2', title: 'Test tool' },
      options: [
        { optionId: 'yes', name: 'Allow always', kind: 'allow_always' },
        { optionId: 'no', name: 'Reject once', kind: 'reject_once' },
      ],
    });

    expect(res.outcome).toEqual({ outcome: 'selected', optionId: 'no' });
  });

  test('extNotification routes session updates to the resolved session', async () => {
    const events: unknown[] = [];
    const callbacks = {
      onUpdate: (e: unknown) => {
        events.push(e);
        return Promise.resolve();
      },
    } as unknown as AgentSessionCallbacks;
    const handlers = createClientHandlers({
      cwd: process.cwd(),
      terminalManager: new TerminalManager(noopLogger),
      logger: noopLogger,
      resolveSession: (p?: { sessionId?: string }) => {
        expect(p?.sessionId).toBe('acp-42');
        return { callbacks, cwd: process.cwd() };
      },
    }) as unknown as Required<Client>;

    await handlers.extNotification('_agentctl.dev/session/update', {
      sessionId: 'acp-42',
      update: { sessionUpdate: 'step_started' },
    });
    expect(events).toContainEqual({ type: 'status', status: 'step_started' });
  });

  test('sessionUpdate maps the canonical current mode update', async () => {
    const events: unknown[] = [];
    const callbacks = {
      onUpdate: (event: unknown) => {
        events.push(event);
      },
      onRequestPermission: () => Promise.resolve({ allowed: false }),
    } as unknown as AgentSessionCallbacks;
    const handlers = createClientHandlers({
      cwd: process.cwd(),
      terminalManager: new TerminalManager(noopLogger),
      logger: noopLogger,
      resolveSession: () => ({ callbacks, cwd: process.cwd() }),
    });

    await handlers.sessionUpdate({
      sessionId: 's',
      update: { sessionUpdate: 'current_mode_update', currentModeId: 'architect' },
    });

    expect(events).toEqual([{ type: 'mode_update', modeId: 'architect' }]);
  });

  test('completeElicitation notifies the resolved session', async () => {
    const completed: string[] = [];
    const callbacks = {
      onUpdate: () => Promise.resolve(),
      onRequestElicitation: () => Promise.resolve({ action: 'submit' }),
      onElicitationCompleted: (id: string) => {
        completed.push(id);
        return Promise.resolve();
      },
    } as unknown as AgentSessionCallbacks;
    const handlers = createClientHandlers({
      cwd: process.cwd(),
      terminalManager: new TerminalManager(noopLogger),
      logger: noopLogger,
      resolveSession: () => ({ callbacks, cwd: process.cwd() }),
    }) as unknown as Required<Client>;

    await handlers.createElicitation({
      sessionId: 's',
      mode: 'url',
      elicitationId: 'el-1',
      url: 'https://example.com/auth',
      message: 'Authenticate',
    });
    await handlers.completeElicitation({ elicitationId: 'el-1' });
    expect(completed).toEqual(['el-1']);
  });

  test('completeElicitation tolerates unresolvable sessions', async () => {
    const handlers = createClientHandlers({
      cwd: process.cwd(),
      terminalManager: new TerminalManager(noopLogger),
      logger: noopLogger,
      resolveSession: () => {
        throw new Error('no session');
      },
    }) as unknown as Required<Client>;

    await expect(handlers.completeElicitation({ elicitationId: 'el-x' })).resolves.toBe(undefined);
  });

  test('namespaced bash extension runs through the terminal manager with session cwd', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentctl-handlers-'));
    const context = makeContext(dir);
    context.resolveSession().callbacks.onRequestPermission = async () => ({ allowed: true });
    const handlers = createClientHandlers(context) as Required<Client>;

    const res = await handlers.extMethod('_agentctl.dev/builtin/bash', {
      sessionId: 's',
      command: 'pwd',
      pty: false,
    });
    expect(res).toHaveProperty('output');
    expect((res as { output: string }).output).toContain(dir);
  }, 15000);

  test('extension requests reject invalid params before reaching a handler', async () => {
    const handlers = requiredHandlers(process.cwd());
    await expect(
      handlers.extMethod('_agentctl.dev/terminal/write', {
        terminalId: 'terminal-1',
        data: 42,
      }),
    ).rejects.toThrow('data must be a non-empty string');
  });
});

test('partial permission requests inherit structured metadata from the same session only', async () => {
  const requests: unknown[] = [];
  const first: AgentSessionCallbacks = {
    onUpdate() {},
    onRequestPermission: async (request) => {
      requests.push(request);
      return { allowed: false };
    },
  };
  const second: AgentSessionCallbacks = {
    onUpdate() {},
    onRequestPermission: first.onRequestPermission,
  };
  const handlers = createClientHandlers({
    cwd: '/tmp',
    logger: noopLogger,
    terminalManager: new TerminalManager(noopLogger),
    resolveSession: (params) => ({
      cwd: '/tmp',
      callbacks: params?.sessionId === 'first' ? first : second,
    }),
  });
  await handlers.sessionUpdate({
    sessionId: 'first',
    update: {
      sessionUpdate: 'tool_call',
      toolCallId: 'shared-id',
      title: 'Edit file',
      kind: 'edit',
      locations: [{ path: '/tmp/file' }],
      rawInput: { path: '/tmp/file', content: 'new' },
    },
  });
  for (const sessionId of ['first', 'second'])
    await handlers.requestPermission({
      sessionId,
      toolCall: { toolCallId: 'shared-id' },
      options: [{ optionId: 'reject', name: 'Deny', kind: 'reject_once' }],
    });
  expect(requests[0]).toMatchObject({
    toolCall: {
      kind: 'edit',
      locations: [{ path: '/tmp/file' }],
      arguments: { path: '/tmp/file', content: 'new' },
    },
  });
  expect((requests[1] as { toolCall: { kind?: string } }).toolCall.kind).toBeUndefined();
});
