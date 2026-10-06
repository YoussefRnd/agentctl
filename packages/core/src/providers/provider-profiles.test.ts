import { expect, test, vi } from 'vitest';
import { createDatabase } from '../db/index.js';
import { ProviderRegistry } from './provider-registry.js';
import { ProviderStore } from './registry/provider-store.js';
import { Provider } from './provider.js';
import { negotiateCapabilities } from './capabilities-negotiator.js';
import { noopLogger } from '../logger.js';

const models = [
  {
    id: 'llm',
    category: 'model',
    name: 'Model',
    type: 'select',
    currentValue: 'preferred',
    options: [
      { value: 'first', name: 'First' },
      { value: 'preferred', name: 'Preferred', contextWindow: 8_000 },
    ],
  },
];
test('named profiles keep independent configuration and track the shared installation', async () => {
  const db = createDatabase(':memory:');
  const store = new ProviderStore(db);
  store.upsert('agent', {
    name: 'Agent',
    command: '/tmp/version-1/agent',
    installState: 'system_available',
    installedVersion: '1',
    configOptions: JSON.stringify(models),
    customEnv: JSON.stringify({ ACCOUNT: 'base' }),
  });
  const registry = new ProviderRegistry(db, noopLogger);
  const first = await registry.createProfile('agent', 'Work');
  const second = await registry.createProfile('agent', 'Personal');
  expect(first.id).not.toBe(second.id);
  expect(first.registryAgentId).toBe('agent');
  expect(first.customEnvConfigured).toEqual({});
  store.update(first.id, {
    protocol: 'v1',
    defaultModel: 'preferred',
    customEnv: JSON.stringify({ ACCOUNT: 'work' }),
  });
  store.update('agent', { command: '/tmp/version-2/agent', installedVersion: '2' });
  expect(registry.getProvider(first.id)?.getLaunchConfig('default', 'medium')).toEqual({
    command: '/tmp/version-2/agent',
    args: [],
    env: { ACCOUNT: 'work', AGENTCTL_ACP_PROTOCOL: 'v1' },
  });
  expect(registry.getProvider(second.id)?.toDiscovery().installedVersion).toBe('2');
  expect(registry.getProvider(second.id)?.getLaunchConfig('default', 'medium').env).toEqual({});
  expect(registry.getProvider(first.id)?.resolveDefaultSelection().selectedModel).toBe('preferred');
  await expect(registry.remove('agent')).rejects.toThrow('profiles');
  await registry.removeProfile(first.id);
  expect((await registry.discover()).find((row) => row.id === first.id)).toBeUndefined();
  expect(registry.getProvider(first.id)).toBeDefined(); // Saved sessions can still resume.
  registry.dispose();
});
test('automatic updates run once per registry agent', async () => {
  const db = createDatabase(':memory:');
  const store = new ProviderStore(db);
  store.upsert('agent', {
    name: 'Agent',
    command: 'agent',
    installState: 'system_available',
    installSource: 'npx',
    installedVersion: '1.0.0',
    version: '2.0.0',
  });
  const registry = new ProviderRegistry(db, noopLogger);
  await registry.createProfile('agent', 'Work');
  await registry.createProfile('agent', 'Personal');
  const install = vi
    .spyOn(registry, 'install')
    .mockResolvedValue({ installedVersion: '2.0.0', updateAvailable: false } as never);
  await registry.autoUpdateInstalledProviders();
  expect(install).toHaveBeenCalledTimes(1);
  registry.dispose();
});
test('unavailable model selection records the requested and advertised fallback', () => {
  const db = createDatabase(':memory:');
  const store = new ProviderStore(db);
  store.upsert('agent', { name: 'Agent', command: 'agent', configOptions: JSON.stringify(models) });
  const selection = negotiateCapabilities(
    new Provider(store.get('agent')!),
    'removed-model',
    'medium',
  );
  expect(selection).toMatchObject({
    selectedModel: 'preferred',
    contextWindow: 8_000,
    modelFallback: { requested: 'removed-model', selected: 'preferred' },
  });
});

test('custom models persist per profile, remain selectable, and reject invalid updates', async () => {
  const db = createDatabase(':memory:');
  const store = new ProviderStore(db);
  store.upsert('agent', { name: 'Agent', command: 'agent', configOptions: JSON.stringify(models) });
  const registry = new ProviderRegistry(db, noopLogger);
  const profile = await registry.createProfile('agent', 'Work');
  await registry.setProviderConfig(profile.id, {
    customModels: [{ id: 'hidden', name: 'Hidden model', contextWindow: 128000 }],
    defaultModel: 'hidden',
  });
  const provider = registry.getProvider(profile.id)!;
  expect(provider.toDiscovery().customModels).toEqual([
    { id: 'hidden', name: 'Hidden model', contextWindow: 128000 },
  ]);
  expect(negotiateCapabilities(provider, 'hidden', 'medium')).toMatchObject({
    selectedModel: 'hidden',
    contextWindow: 128000,
    modelFallback: undefined,
  });
  expect(registry.getProvider('agent')?.toDiscovery().customModels).toEqual([]);
  await expect(
    registry.setProviderConfig(profile.id, {
      customModels: [
        { id: 'duplicate', name: 'A' },
        { id: 'duplicate', name: 'B' },
      ],
    }),
  ).rejects.toThrow();
  expect(provider.resolveDefaultSelection().selectedModel).toBe('hidden');
  registry.dispose();
});
