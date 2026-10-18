import {
  agent,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  type SessionNotification,
} from '@agentclientprotocol/sdk';
import assert from 'node:assert/strict';
import type { ChildProcess, spawn as spawnFn } from 'node:child_process';
import { PassThrough, Readable, Writable } from 'node:stream';
import { expect, test } from 'vite-plus/test';
import type { AgentDescriptor, AgentUpdate } from '../../agent/types.js';
import type { CacheStorage } from '../types.js';
import { cleanEnv, createAgentConnection } from './process-transport.js';

test('control connections cancel permissions and reject unadvertised client operations', async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const child = { stdin, stdout, stderr: null, kill: () => true } as unknown as ChildProcess;
  const handle = createAgentConnection('agent', [], {}, (() => child) as typeof spawnFn);
  const peer = agent().connect(
    ndJsonStream(
      Writable.toWeb(stdout) as WritableStream<Uint8Array>,
      Readable.toWeb(stdin) as ReadableStream<Uint8Array>,
    ),
  );
  try {
    await expect(
      peer.client.request(methods.client.session.requestPermission, {
        sessionId: 's',
        toolCall: { toolCallId: 't', title: 'Run' },
        options: [{ optionId: 'provider-choice', name: 'Allow', kind: 'allow_once' }],
      }),
    ).resolves.toEqual({ outcome: { outcome: 'cancelled' } });
    await expect(
      peer.client.request(methods.client.fs.readTextFile, { sessionId: 's', path: '/tmp/nope' }),
    ).rejects.toMatchObject({ code: -32601 });
    await expect(
      peer.client.request(methods.client.fs.writeTextFile, {
        sessionId: 's',
        path: '/tmp/nope',
        content: 'no',
      }),
    ).rejects.toMatchObject({ code: -32601 });
    await expect(
      peer.client.request(methods.client.elicitation.create, {
        sessionId: 's',
        mode: 'form',
        message: 'Unsupported',
        requestedSchema: { type: 'object', properties: {} },
      }),
    ).rejects.toMatchObject({ code: -32602 });
  } finally {
    peer.close();
    handle.connection.close?.();
    stdin.destroy();
    stdout.destroy();
  }
});

test('cleanEnv overlays values and strips npm config variables', () => {
  const previousUserAgent = process.env.npm_config_user_agent;
  const previousCustom = process.env.AGENTCTL_TEST_FLAG;

  process.env.npm_config_user_agent = 'pnpm/11';
  process.env.AGENTCTL_TEST_FLAG = 'base';

  try {
    const env = cleanEnv({ AGENTCTL_TEST_FLAG: 'override' });

    assert.equal(env.AGENTCTL_TEST_FLAG, 'override');
    assert.equal(env.npm_config_user_agent, undefined);
  } finally {
    if (previousUserAgent === undefined) {
      delete process.env.npm_config_user_agent;
    } else {
      process.env.npm_config_user_agent = previousUserAgent;
    }

    if (previousCustom === undefined) {
      delete process.env.AGENTCTL_TEST_FLAG;
    } else {
      process.env.AGENTCTL_TEST_FLAG = previousCustom;
    }
  }
});

test('createAgentConnection passes cleaned env to spawn and returns the child handle', () => {
  let killCount = 0;
  const stdin = new PassThrough();
  const stdout = new PassThrough();

  const child = {
    stdin,
    stdout,
    stderr: null,
    kill: () => {
      killCount += 1;
      return true;
    },
  } as unknown as ChildProcess;

  let capturedEnv: Record<string, string> | undefined;
  const fakeSpawn = ((
    command: string,
    args: string[],
    options: { env?: Record<string, string> },
  ) => {
    void command;
    void args;
    capturedEnv = options.env;
    return child;
  }) as unknown as typeof spawnFn;

  const previousUserAgent = process.env.npm_config_user_agent;
  process.env.npm_config_user_agent = 'pnpm/11';

  try {
    const handle = createAgentConnection(
      'agent',
      ['--probe'],
      { AGENTCTL_TEST_FLAG: '1' },
      fakeSpawn,
    );

    assert.equal(handle.child, child);
    assert.equal(capturedEnv?.AGENTCTL_TEST_FLAG, '1');
    assert.equal(capturedEnv.npm_config_user_agent, undefined);
    assert.equal(killCount, 0);

    stdin.destroy();
    stdout.destroy();
  } finally {
    if (previousUserAgent === undefined) {
      delete process.env.npm_config_user_agent;
    } else {
      process.env.npm_config_user_agent = previousUserAgent;
    }
  }
});

test('createAgentConnection throws if stdio is missing', () => {
  let killCount = 0;
  const child = {
    stdin: null,
    stdout: null,
    stderr: null,
    kill: () => {
      killCount += 1;
      return true;
    },
  } as unknown as ChildProcess;

  const fakeSpawn = (() => child) as unknown as typeof spawnFn;

  assert.throws(() => {
    createAgentConnection('agent', [], {}, fakeSpawn);
  }, /missing stdin\/stdout/);
  assert.equal(killCount, 1);
});

test('AcpV1AgentDriver.probe uses cache and skips spawn on cache hit', async () => {
  const { AcpV1AgentDriver } = await import('../v1/driver.js');

  const cacheMap = new Map<string, AgentDescriptor>();
  const mockCache: CacheStorage = {
    get: (key: string) => Promise.resolve(cacheMap.get(key) ?? null),
    set: (key: string, val: AgentDescriptor) => {
      cacheMap.set(key, val);
      return Promise.resolve();
    },
  };

  let spawnCount = 0;
  const fakeSpawn = (() => {
    spawnCount++;
    return {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: null,
      on: () => undefined,
      once: () => undefined,
      kill: () => true,
    };
  }) as unknown as typeof spawnFn;

  const fakeTransport = () => ({
    stdin: new PassThrough() as unknown as WritableStream<Uint8Array>,
    stdout: new PassThrough() as unknown as ReadableStream<Uint8Array>,
    closed: Promise.resolve(),
    child: {} as unknown as ChildProcess,
    isAlive: true,
    isClosed: false,
    kill: () => undefined,
  });

  const runtime = new AcpV1AgentDriver(fakeSpawn, undefined, fakeTransport, mockCache);

  const testResult = {
    status: 'ready' as const,
    configOptions: [],
    authMethods: [],
    supportsDynamicModel: true,
    supportsDynamicConfig: false,
  };

  const { getCacheKey } = await import('../cache/launch-identity.js');
  const hashKey = getCacheKey('test-cmd', [], cleanEnv({}), {
    protocolVersion: String(PROTOCOL_VERSION),
  });
  await mockCache.set(hashKey, testResult);

  const result = await runtime.inspectProvider('test-cmd', [], {});
  assert.equal(result.supportsDynamicModel, true);
  assert.equal(spawnCount, 0); // Verify spawn was bypassed
});

test('parseNotificationToEvents parses tool_call rawInput with nested arguments', async () => {
  const { parseNotificationToEvents } = await import('../protocol/events.js');
  const notification = {
    sessionId: 'sess_123',
    update: {
      sessionUpdate: 'tool_call' as const,
      toolCallId: 'read_file__1',
      title: 'Reading file',
      rawInput: {
        name: 'read_file',
        arguments: {
          path: 'test.txt',
        },
      },
    },
  };

  const events = parseNotificationToEvents(notification);
  assert.equal(events.length, 1);
  const event = events[0] as Extract<AgentUpdate, { type: 'tool_call' }>;
  assert.equal(event.type, 'tool_call');
  assert.equal(event.call.name, 'read_file');
  assert.deepEqual(event.call.arguments, { path: 'test.txt' });
});

test('parseNotificationToEvents parses tool_call rawInput as direct arguments object', async () => {
  const { parseNotificationToEvents } = await import('../protocol/events.js');
  const notification = {
    sessionId: 'sess_123',
    update: {
      sessionUpdate: 'tool_call' as const,
      toolCallId: 'run_shell_command__2',
      title: 'Running command',
      rawInput: {
        command: 'echo hello',
      },
    },
  };

  const events = parseNotificationToEvents(notification);
  assert.equal(events.length, 1);
  const event = events[0] as Extract<AgentUpdate, { type: 'tool_call' }>;
  assert.equal(event.type, 'tool_call');
  assert.equal(event.call.name, 'Running command');
  assert.deepEqual(event.call.arguments, { command: 'echo hello' });
});

test('parseNotificationToEvents parses usage_update notification', async () => {
  const { parseNotificationToEvents } = await import('../protocol/events.js');
  const notification = {
    sessionId: 'sess_123',
    update: {
      sessionUpdate: 'usage_update' as const,
      used: 53000,
      size: 200000,
      cost: {
        amount: 0.045,
        currency: 'USD',
      },
    },
  };

  const events = parseNotificationToEvents(notification);
  assert.equal(events.length, 1);
  const event = events[0] as Extract<AgentUpdate, { type: 'usage_update' }>;
  assert.equal(event.type, 'usage_update');
  assert.equal(event.used, 53000);
  assert.equal(event.size, 200000);
  assert.deepEqual(event.cost, { amount: 0.045, currency: 'USD' });
});

test('parseNotificationToEvents normalizes usage_update values from provider metadata', async () => {
  const { parseNotificationToEvents } = await import('../protocol/events.js');
  const notification = {
    sessionId: 'sess_123',
    update: {
      sessionUpdate: 'usage_update' as const,
      used: '53000',
      size: '200000',
      cost: {
        amount: '0.045',
        currency: 'USD',
      },
    },
  };

  const events = parseNotificationToEvents(notification as unknown as SessionNotification);
  assert.equal(events.length, 1);
  const event = events[0] as Extract<AgentUpdate, { type: 'usage_update' }>;
  assert.equal(event.type, 'usage_update');
  assert.equal(event.used, 53000);
  assert.equal(event.size, 200000);
  assert.deepEqual(event.cost, { amount: 0.045, currency: 'USD' });
});
