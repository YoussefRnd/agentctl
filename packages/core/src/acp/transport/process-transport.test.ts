import { test } from 'vitest';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import type { ChildProcess, spawn as spawnFn } from 'node:child_process';
import type { SessionNotification } from '@agentclientprotocol/sdk';
import {
  cleanEnv,
  createAgentConnection,
  type CacheStorage,
  type AgentProbeResult,
  type DomainAgentEvent,
} from '../index.js';

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

test('DefaultAgentRuntime.probe uses cache and skips spawn on cache hit', async () => {
  const crypto = await import('node:crypto');
  const { DefaultAgentRuntime } = await import('../index.js');

  const cacheMap = new Map<string, AgentProbeResult>();
  const mockCache: CacheStorage = {
    get: (key: string) => Promise.resolve(cacheMap.get(key) ?? null),
    set: (key: string, val: AgentProbeResult) => {
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
    kill: () => undefined,
  });

  const runtime = new DefaultAgentRuntime(fakeSpawn, undefined, fakeTransport, mockCache);

  const testResult = {
    status: 'ready' as const,
    configOptions: [],
    authMethods: [],
    supportsDynamicModel: true,
    supportsDynamicConfig: false,
  };

  const cleanEnv = (await import('../index.js')).cleanEnv;
  const data = JSON.stringify({ command: 'test-cmd', args: [], env: cleanEnv({}) });
  const hashKey = crypto.createHash('sha256').update(data).digest('hex');
  await mockCache.set(hashKey, testResult);

  const result = await runtime.probe('test-cmd', [], {});
  assert.equal(result.supportsDynamicModel, true);
  assert.equal(spawnCount, 0); // Verify spawn was bypassed
});

test('parseNotificationToEvents parses tool_call rawInput with nested arguments', async () => {
  const { parseNotificationToEvents } = await import('../index.js');
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
  const event = events[0] as Extract<DomainAgentEvent, { type: 'tool_call' }>;
  assert.equal(event.type, 'tool_call');
  assert.equal(event.call.name, 'read_file');
  assert.deepEqual(event.call.arguments, { path: 'test.txt' });
});

test('parseNotificationToEvents parses tool_call rawInput as direct arguments object', async () => {
  const { parseNotificationToEvents } = await import('../index.js');
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
  const event = events[0] as Extract<DomainAgentEvent, { type: 'tool_call' }>;
  assert.equal(event.type, 'tool_call');
  assert.equal(event.call.name, 'run_shell_command');
  assert.deepEqual(event.call.arguments, { command: 'echo hello' });
});

test('parseNotificationToEvents parses usage_update notification', async () => {
  const { parseNotificationToEvents } = await import('../index.js');
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
  const event = events[0] as Extract<DomainAgentEvent, { type: 'usage_update' }>;
  assert.equal(event.type, 'usage_update');
  assert.equal(event.used, 53000);
  assert.equal(event.size, 200000);
  assert.deepEqual(event.cost, { amount: 0.045, currency: 'USD' });
});

test('parseNotificationToEvents normalizes usage_update values from provider metadata', async () => {
  const { parseNotificationToEvents } = await import('../index.js');
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
  const event = events[0] as Extract<DomainAgentEvent, { type: 'usage_update' }>;
  assert.equal(event.type, 'usage_update');
  assert.equal(event.used, 53000);
  assert.equal(event.size, 200000);
  assert.deepEqual(event.cost, { amount: 0.045, currency: 'USD' });
});
