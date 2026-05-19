import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import type { ChildProcess } from 'node:child_process';
import type { DriverDiscovery, RegistryAgent } from '@agentctl/shared';
import { probeAgent } from './acp-probe.js';

function createAgent(): RegistryAgent {
  return {
    id: 'claude-acp',
    name: 'Claude ACP',
    version: '1.0.0',
    description: 'test agent',
    authors: [],
    distribution: {},
  };
}

function createChild(): { child: ChildProcess; killCount: () => number } {
  let killCount = 0;
  const emitter = new EventEmitter();

  const child = {
    stdin: null,
    stdout: null,
    stderr: null,
    kill: () => {
      killCount += 1;
      return true;
    },
    on: emitter.on.bind(emitter),
  } as unknown as ChildProcess;

  return { child, killCount: () => killCount };
}

test('probeAgent returns ready discovery data on success', async () => {
  const agent = createAgent();
  const { child, killCount } = createChild();
  const initCalls: unknown[] = [];
  const sessionCalls: unknown[] = [];

  const result = await probeAgent(
    agent,
    { command: 'agent', args: ['--probe'], env: { AGENTCTL_TEST_FLAG: '1' } },
    {
      debug() {},
      error() {},
      warn() {},
      info() {},
    },
    {
      createConnection: () => ({
        child,
        connection: {
          initialize: async (params) => {
            initCalls.push(params);
            return { authMethods: [{ id: 'login', name: 'Login' }] };
          },
          newSession: async (params) => {
            sessionCalls.push(params);
            return {
              sessionId: 'session-1',
              configOptions: [
                {
                  id: 'model',
                  name: 'Model',
                  type: 'select',
                  currentValue: 'sonnet',
                  options: [{ value: 'sonnet', name: 'Sonnet' }],
                },
              ],
            };
          },
          closed: Promise.resolve(),
        },
      }),
    },
  );

  assert.equal(result.status, 'ready');
  assert.equal(result.id, agent.id);
  assert.equal(result.authMethods.length, 1);
  assert.equal(result.configOptions?.[0]?.currentValue, 'sonnet');
  assert.equal(initCalls.length, 1);
  assert.equal(sessionCalls.length, 1);
  assert.equal(killCount(), 1);
});

test('probeAgent maps auth_required to needs_auth', async () => {
  const agent = createAgent();
  const { child, killCount } = createChild();

  const result = await probeAgent(
    agent,
    { command: 'agent', args: [], env: {} },
    {
      debug() {},
      error() {},
      warn() {},
      info() {},
    },
    {
      createConnection: () => ({
        child,
        connection: {
          initialize: async () => ({ authMethods: [] }),
          newSession: async () => {
            throw {
              code: 'auth_required',
              data: {
                configOptions: [
                  {
                    id: 'thinking',
                    name: 'Thinking',
                    type: 'select',
                    currentValue: 'medium',
                    options: [{ value: 'medium', name: 'Medium' }],
                  },
                ],
              },
            };
          },
          closed: Promise.resolve(),
        },
      }),
    },
  );

  assert.equal(result.status, 'needs_auth');
  assert.equal(result.configOptions?.[0]?.id, 'thinking');
  assert.equal(killCount(), 1);
});

test('probeAgent returns not_found when initialization times out', async () => {
  const agent = createAgent();
  const { child, killCount } = createChild();

  const result = await probeAgent(
    agent,
    { command: 'agent', args: [], env: {} },
    {
      debug() {},
      error() {},
      warn() {},
      info() {},
    },
    {
      timeoutMs: 1,
      createConnection: () => ({
        child,
        connection: {
          initialize: async () => new Promise(() => {}),
          newSession: async () => ({ configOptions: [] }),
          closed: Promise.resolve(),
        },
      }),
    },
  );

  assert.equal(result.status, 'not_found');
  assert.equal(killCount(), 1);
});
