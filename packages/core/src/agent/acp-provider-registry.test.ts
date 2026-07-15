import { test, describe, expect } from 'vitest';
import { ProviderRegistry } from './acp-provider-registry.js';
import { noopLogger } from '../logger.js';
import type { RegistryAgent } from '@agentctl/shared';
import { createDatabase } from '../db/index.js';
import { providers, registrySnapshots } from '../db/schema.js';

describe('ProviderRegistry', () => {
  test('ProviderRegistry discover returns providers from DB', async () => {
    const db = createDatabase(':memory:');

    await db.insert(providers).values({
      id: 'claude-acp',
      name: 'Claude Code',
      installState: 'installed_local',
      authState: 'authenticated',
      command: 'claude',

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
    expect(providersList[0].installState).toBe('installed_local');
    expect(providersList[0].authState).toBe('authenticated');
  });

  test('ProviderRegistry getProvider returns specific provider from DB', async () => {
    const db = createDatabase(':memory:');

    await db.insert(providers).values({
      id: 'claude-acp',
      name: 'Claude Code',
      installState: 'installed_local',
      authState: 'authenticated',
      command: 'claude',

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

  test('install persists provider with system_available state and enables it', async () => {
    const db = createDatabase(':memory:');
    const registry = new ProviderRegistry(db, noopLogger);
    const agent: RegistryAgent = {
      id: 'npx-agent',
      name: 'NPX Agent',
      version: '1.2.3',
      description: 'distributed via npx',
      authors: [],
      distribution: { npx: { package: 'npx-agent-pkg', args: ['--foo'], env: { BAR: 'baz' } } },
    };
    await db.insert(registrySnapshots).values({
      data: JSON.stringify({ agents: [agent] }),
      fetchedAt: new Date(),
    });

    const result = await registry.install('npx-agent');

    expect(result.id).toBe('npx-agent');
    expect(result.installState).toBe('system_available');
    expect(result.command).toBe('npx');
  });

  test('remove resets provider to not_installed and disables it', async () => {
    const db = createDatabase(':memory:');
    const registry = new ProviderRegistry(db, noopLogger);
    const agent: RegistryAgent = {
      id: 'npx-agent',
      name: 'NPX Agent',
      version: '1.2.3',
      description: 'distributed via npx',
      authors: [],
      distribution: { npx: { package: 'npx-agent-pkg', args: [], env: {} } },
    };
    await db.insert(registrySnapshots).values({
      data: JSON.stringify({ agents: [agent] }),
      fetchedAt: new Date(),
    });
    await registry.install('npx-agent');

    const result = await registry.remove('npx-agent');

    expect(result.installState).toBe('not_installed');
  });
});
