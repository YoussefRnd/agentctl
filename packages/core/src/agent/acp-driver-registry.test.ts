import { test } from 'vitest';
import assert from 'node:assert/strict';
import { DriverRegistry } from './acp-driver-registry.js';
import type { DbClient } from './acp-session.js';
import { noopLogger } from '../logger.js';

test('DriverRegistry discover returns drivers from DB', async () => {
  const mockRows = [
    {
      id: 'claude-code',
      name: 'Claude Code',
      status: 'ready',
      command: 'claude',
      launchArgs: '[]',
      launchEnv: '{}',
      configOptions: '[]',
      authMethods: '[]',
      version: '1.0.0',
      description: 'test',
      icon: 'icon',
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
  assert.equal(drivers[0].id, 'claude-code');
  assert.equal(drivers[0].status, 'ready');
});

test('DriverRegistry getDriver returns specific driver from DB', async () => {
  const mockRow = {
    id: 'claude-code',
    name: 'Claude Code',
    status: 'ready',
    command: 'claude',
    launchArgs: '[]',
    launchEnv: '{}',
    configOptions: '[]',
    authMethods: '[]',
    version: '1.0.0',
    description: 'test',
    icon: 'icon',
  };

  const db = {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([mockRow]),
      }),
    }),
  } as unknown as DbClient;

  const registry = new DriverRegistry(db, noopLogger);
  const driver = await registry.getDriver('claude-code');

  assert.ok(driver);
  assert.equal(driver.id, 'claude-code');
});
