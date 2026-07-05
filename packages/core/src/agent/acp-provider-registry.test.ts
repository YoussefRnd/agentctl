import { test, describe, expect } from 'vitest';
import { ProviderRegistry } from './acp-provider-registry.js';
import type { ProviderData } from './provider.js';
import { noopLogger } from '../logger.js';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import type { ACPConnectionHandle } from './acp-transport.js';
import type { RegistryAgent } from '@agentctl/shared';
import { createDatabase } from '../db/index.js';
import { providers, projects, sessions, systemSettings } from '../db/schema.js';

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

describe('ProviderRegistry', () => {
  test('ProviderRegistry discover returns providers from DB', async () => {
    const db = createDatabase(':memory:');

    await db.insert(providers).values({
      id: 'claude-acp',
      name: 'Claude Code',
      status: 'ready',
      command: 'claude',
      enabled: false,
      launchArgs: '[]',
      launchEnv: '{}',
      customEnv: '{}',
      configOptions: '[]',
      authMethods: '[]',
      version: '1.0.0',
      description: 'test',
      icon: 'icon',
      createdAt: new Date(),
      updatedAt: new Date(),
      supportsDynamicModel: false,
      supportsDynamicConfig: false,
    });

    const registry = new ProviderRegistry(db, noopLogger);
    const providersList = await registry.discover();

    expect(providersList.length).toBe(1);
    expect(providersList[0].id).toBe('claude-acp');
    expect(providersList[0].status).toBe('ready');
  });

  test('ProviderRegistry getProvider returns specific provider from DB', async () => {
    const db = createDatabase(':memory:');

    await db.insert(providers).values({
      id: 'claude-acp',
      name: 'Claude Code',
      status: 'ready',
      command: 'claude',
      enabled: false,
      launchArgs: '[]',
      launchEnv: '{}',
      customEnv: '{}',
      configOptions: '[]',
      authMethods: '[]',
      version: '1.0.0',
      description: 'test',
      icon: 'icon',
      createdAt: new Date(),
      updatedAt: new Date(),
      supportsDynamicModel: false,
      supportsDynamicConfig: false,
    });

    const registry = new ProviderRegistry(db, noopLogger);
    const provider = await registry.getProvider('claude-acp');

    expect(provider).toBeDefined();
    expect(provider?.id).toBe('claude-acp');
  });

  test('probeAgent returns ready discovery data on success', async () => {
    const db = createDatabase(':memory:');
    const agent = createAgent();
    const { child, killCount } = createChild();
    const initCalls: unknown[] = [];
    const sessionCalls: unknown[] = [];

    const mockCreateConnection = () =>
      ({
        child,
        connection: {
          initialize: (params: unknown) => {
            initCalls.push(params);
            return Promise.resolve({ authMethods: [{ id: 'login', name: 'Login' }] });
          },
          newSession: (params: unknown) => {
            sessionCalls.push(params);
            return Promise.resolve({
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
            });
          },
          closed: Promise.resolve(),
        },
      }) as unknown as ACPConnectionHandle;

    const registry = new ProviderRegistry(db, noopLogger, mockCreateConnection);

    const result = await registry.probeAgent(agent, {
      command: 'agent',
      args: ['--probe'],
      env: { AGENTCTL_TEST_FLAG: '1' },
    });

    expect(result.status).toBe('ready');
    expect(result.id).toBe(agent.id);
    expect(result.authMethods.length).toBe(1);
    expect(result.configOptions?.[0]?.currentValue).toBe('sonnet');
    expect(initCalls.length).toBe(1);
    expect(sessionCalls.length).toBe(1);
    expect(killCount()).toBe(1);
  });

  test('probeAgent maps auth_required to needs_auth', async () => {
    const db = createDatabase(':memory:');
    const agent = createAgent();
    const { child, killCount } = createChild();

    const mockCreateConnection = () =>
      ({
        child,
        connection: {
          initialize: () => Promise.resolve({ authMethods: [] }),
          newSession: () => {
            const err = Object.assign(new Error('auth_required'), {
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
            });
            return Promise.reject(err);
          },
          closed: Promise.resolve(),
        },
      }) as unknown as ACPConnectionHandle;

    const registry = new ProviderRegistry(db, noopLogger, mockCreateConnection);

    const result = await registry.probeAgent(agent, { command: 'agent', args: [], env: {} });

    expect(result.status).toBe('needs_auth');
    expect(result.configOptions?.[0]?.id).toBe('thinking');
    expect(killCount()).toBe(1);
  });

  test('pickWarmProviderId prioritizes last used session provider', async () => {
    const db = createDatabase(':memory:');

    // Set up project and sessions
    await db.insert(projects).values({
      id: 'proj-1',
      name: 'Test Project',
      path: '/tmp/proj-1',
    });

    // Insert an older session using 'opencode'
    await db.insert(sessions).values({
      id: 'sess-old',
      projectId: 'proj-1',
      branch: 'main',
      worktreePath: '/tmp/proj-1',
      taskSlug: 'test-slug',
      agent: 'opencode',
      selectedProvider: 'opencode',
      baseCommit: 'hash',
      updatedAt: new Date(Date.now() - 10000),
    });

    // Insert a newer session using 'gemini'
    await db.insert(sessions).values({
      id: 'sess-new',
      projectId: 'proj-1',
      branch: 'main',
      worktreePath: '/tmp/proj-1',
      taskSlug: 'test-slug',
      agent: 'gemini',
      selectedProvider: 'gemini',
      baseCommit: 'hash',
      updatedAt: new Date(),
    });

    const registry = new ProviderRegistry(db, noopLogger);

    const existingRows = [
      { id: 'opencode', enabled: true } as unknown as ProviderData,
      { id: 'gemini', enabled: true } as unknown as ProviderData,
    ];

    const supportedRegistry = [
      { id: 'opencode' } as unknown as RegistryAgent,
      { id: 'gemini' } as unknown as RegistryAgent,
    ];

    // @ts-expect-error - testing private method
    const warmId = await registry.pickWarmProviderId(existingRows, supportedRegistry);
    expect(warmId).toBe('gemini');
  });

  test('pickWarmProviderId ignores disabled providers', async () => {
    const db = createDatabase(':memory:');
    const registry = new ProviderRegistry(db, noopLogger);

    const existingRows = [
      { id: 'opencode', enabled: false } as unknown as ProviderData,
      { id: 'gemini', enabled: true } as unknown as ProviderData,
    ];

    const supportedRegistry = [
      { id: 'opencode' } as unknown as RegistryAgent,
      { id: 'gemini' } as unknown as RegistryAgent,
    ];

    await db.insert(systemSettings).values({
      key: 'defaultProviderId',
      value: 'opencode',
    });

    // @ts-expect-error - testing private method
    const warmId = await registry.pickWarmProviderId(existingRows, supportedRegistry);
    expect(warmId).toBe('gemini');
  });

  test('setProviderEnabled cascades defaultProviderId setting changes', async () => {
    const db = createDatabase(':memory:');
    const registry = new ProviderRegistry(db, noopLogger);

    await db.insert(providers).values([
      {
        id: 'opencode',
        name: 'OpenCode',
        status: 'ready',
        command: 'opencode',
        enabled: true,
        launchArgs: '[]',
        launchEnv: '{}',
        customEnv: '{}',
        configOptions: '[]',
        authMethods: '[]',
      },
      {
        id: 'gemini',
        name: 'Gemini',
        status: 'ready',
        command: 'gemini',
        enabled: true,
        launchArgs: '[]',
        launchEnv: '{}',
        customEnv: '{}',
        configOptions: '[]',
        authMethods: '[]',
      },
    ]);

    await db.insert(systemSettings).values({
      key: 'defaultProviderId',
      value: 'opencode',
    });

    await registry.setProviderEnabled('opencode', false);

    const settings = await registry.getSettings();
    expect(settings.defaultProviderId).toBe('gemini');

    await registry.setProviderEnabled('gemini', false);
    const settingsEmpty = await registry.getSettings();
    expect(settingsEmpty.defaultProviderId).toBe('');

    await registry.setProviderEnabled('opencode', true);
    const settingsRestored = await registry.getSettings();
    expect(settingsRestored.defaultProviderId).toBe('opencode');
  });
});
