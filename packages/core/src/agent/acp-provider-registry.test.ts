import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { ProviderRegistry } from './acp-provider-registry.js';
import type { DbClient } from './acp-session.js';
import { noopLogger } from '../logger.js';
import * as probeModule from './acp-probe.js';

test('ProviderRegistry discover returns providers from DB', async () => {
  const mockRows = [
    {
      id: 'claude-acp',
      name: 'Claude Code',
      status: 'ready',
      command: 'claude',
      enabled: false,
      launchArgs: '[]',
      launchEnv: '{}',
      configOptions: '[]',
      authMethods: '[]',
      version: '1.0.0',
      description: 'test',
      icon: 'icon',
      supportsDynamicModel: false,
      supportsDynamicConfig: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      customEnv: '{}',
    },
  ];

  const db = {
    select: () => ({
      from: () => Promise.resolve(mockRows),
    }),
  } as unknown as DbClient;

  const registry = new ProviderRegistry(db, noopLogger);
  const providersList = await registry.discover();

  assert.equal(providersList.length, 1);
  assert.equal(providersList[0].id, 'claude-acp');
  assert.equal(providersList[0].status, 'ready');
});

test('ProviderRegistry getProvider returns specific provider from DB', async () => {
  const mockRow = {
    id: 'claude-acp',
    name: 'Claude Code',
    status: 'ready',
    command: 'claude',
    enabled: false,
    launchArgs: '[]',
    launchEnv: '{}',
    configOptions: '[]',
    authMethods: '[]',
    version: '1.0.0',
    description: 'test',
    icon: 'icon',
    supportsDynamicModel: false,
    supportsDynamicConfig: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    customEnv: '{}',
  };

  const db = {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([mockRow]),
      }),
    }),
  } as unknown as DbClient;

  const registry = new ProviderRegistry(db, noopLogger);
  const provider = await registry.getProvider('claude-acp');

  assert.ok(provider);
  assert.equal(provider.id, 'claude-acp');
});

test('ProviderRegistry ensureProviderReady performs lazy binary check when force is false', async () => {
  const mockRow = {
    id: 'claude-acp',
    name: 'Claude Code',
    status: 'ready' as const,
    command: 'node', // exists on path
    enabled: true,
    launchArgs: '[]',
    launchEnv: '{}',
    configOptions: '[]',
    authMethods: '[]',
    version: '1.0.0',
    description: 'test',
    icon: 'icon',
    supportsDynamicModel: false,
    supportsDynamicConfig: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    customEnv: '{}',
  };

  const db = {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([mockRow]),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => Promise.resolve(),
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: () => Promise.resolve(),
      }),
    }),
  } as unknown as DbClient;

  const probeSpy = vi.spyOn(probeModule, 'probeAgent').mockResolvedValue({
    id: 'claude-acp',
    label: 'Claude Code',
    status: 'ready',
    command: 'node',
    enabled: true,
    launchArgs: [],
    launchEnv: {},
    customEnv: {},
    configOptions: [],
    authMethods: [],
    version: '1.0.0',
    description: 'test',
    supportsDynamicModel: false,
    supportsDynamicConfig: false,
  });

  const registry = new ProviderRegistry(db, noopLogger);

  // 1. Call ensureProviderReady with force: false
  // Since status is 'ready' and binary 'node' is on PATH, it should return immediately without probing
  const resultLazy = await registry.ensureProviderReady('claude-acp', { force: false });
  assert.equal(resultLazy.status, 'ready');
  assert.equal(probeSpy.mock.calls.length, 0);

  // 2. Call ensureProviderReady with force: true
  // It should bypass the cache and run probeAgent
  const resultForced = await registry.ensureProviderReady('claude-acp', { force: true });
  assert.equal(resultForced.status, 'ready');
  assert.equal(probeSpy.mock.calls.length, 1);

  probeSpy.mockRestore();
});
