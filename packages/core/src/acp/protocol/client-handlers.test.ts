import { test, describe, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CLIENT_METHODS, type Client } from '@agentclientprotocol/sdk';
import { createClientHandlers } from './client-handlers.js';
import { TerminalManager } from './terminal-manager.js';
import { noopLogger } from '../../logger.js';
import type { SessionCallbacks } from '../types.js';

function makeContext(cwd: string) {
  const onEvent = () => Promise.resolve();
  const callbacks = {
    onEvent,
    onRequestPermission: () => Promise.resolve({ allowed: false }),
  } as unknown as SessionCallbacks;
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
    // keys; any other spelling silently falls through to extMethod and
    // returns {}. Keys below MUST stay in sync with the SDK dispatch table.
    expect(Object.keys(handlers).sort()).toEqual(
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

  test('readTextFile resolves relative to session cwd', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentctl-handlers-'));
    const file = path.join(dir, 'hello.txt');
    fs.writeFileSync(file, 'line one\nline two\nline three\n');
    const handlers = requiredHandlers(dir);

    const res = await handlers.readTextFile({ sessionId: 's', path: 'hello.txt' });
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
      onEvent: () => Promise.resolve(),
      onRequestPermission: () => Promise.resolve({ allowed: true, optionId: 'allow-once' }),
    } as unknown as SessionCallbacks;
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
      onEvent: (e: unknown) => {
        events.push(e);
        return Promise.resolve();
      },
    } as unknown as SessionCallbacks;
    const handlers = createClientHandlers({
      cwd: process.cwd(),
      terminalManager: new TerminalManager(noopLogger),
      logger: noopLogger,
      resolveSession: (p?: { sessionId?: string }) => {
        expect(p?.sessionId).toBe('acp-42');
        return { callbacks, cwd: process.cwd() };
      },
    }) as unknown as Required<Client>;

    await handlers.extNotification('session/session_notification', {
      sessionId: 'acp-42',
      update: { sessionUpdate: 'step_started' },
    });
    expect(events).toContainEqual({ type: 'status', status: 'step_started' });
  });

  test('sessionUpdate maps the canonical current mode update', async () => {
    const events: unknown[] = [];
    const callbacks = {
      onEvent: (event: unknown) => {
        events.push(event);
      },
      onRequestPermission: () => Promise.resolve({ allowed: false }),
    } as unknown as SessionCallbacks;
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

    expect(events).toEqual([{ type: 'mode_update', modeId: 'architect', _meta: undefined }]);
  });

  test('completeElicitation notifies the resolved session', async () => {
    const completed: string[] = [];
    const callbacks = {
      onEvent: () => Promise.resolve(),
      onRequestElicitation: () => Promise.resolve({ action: 'submit' }),
      onElicitationCompleted: (id: string) => {
        completed.push(id);
        return Promise.resolve();
      },
    } as unknown as SessionCallbacks;
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

  test('extMethod builtin/bash runs through the terminal manager with session cwd', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentctl-handlers-'));
    const handlers = requiredHandlers(dir);

    const res = await handlers.extMethod('builtin/bash', {
      sessionId: 's',
      command: 'pwd',
      pty: false,
    });
    expect(res).toHaveProperty('output');
    expect((res as { output: string }).output).toContain(dir);
  }, 15000);
});
