import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { DriverRegistry } from './acp-driver-registry.js';
import type { DbClient } from './acp-session.js';
import { noopLogger } from '../logger.js';
import * as probeModule from './acp-probe.js';

test('DriverRegistry discover returns drivers from DB', async () => {
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

  const registry = new DriverRegistry(db, noopLogger);
  const drivers = await registry.discover();

  assert.equal(drivers.length, 1);
  assert.equal(drivers[0].id, 'claude-acp');
  assert.equal(drivers[0].status, 'ready');
});

test('DriverRegistry getDriver returns specific driver from DB', async () => {
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

  const registry = new DriverRegistry(db, noopLogger);
  const driver = await registry.getDriver('claude-acp');

  assert.ok(driver);
  assert.equal(driver.id, 'claude-acp');
});

test('DriverRegistry ensureDriverReady performs lazy binary check when force is false', async () => {
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

  const registry = new DriverRegistry(db, noopLogger);

  // 1. Call ensureDriverReady with force: false
  // Since status is 'ready' and binary 'node' is on PATH, it should return immediately without probing
  const resultLazy = await registry.ensureDriverReady('claude-acp', { force: false });
  assert.equal(resultLazy.status, 'ready');
  assert.equal(probeSpy.mock.calls.length, 0);

  // 2. Call ensureDriverReady with force: true
  // It should bypass the cache and run probeAgent
  const resultForced = await registry.ensureDriverReady('claude-acp', { force: true });
  assert.equal(resultForced.status, 'ready');
  assert.equal(probeSpy.mock.calls.length, 1);

  probeSpy.mockRestore();
});
