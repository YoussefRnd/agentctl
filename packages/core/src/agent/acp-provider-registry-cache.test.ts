import assert from 'node:assert/strict';
import type { RegistryAgent } from '@agentctl/shared';
import { beforeEach, test, vi } from 'vitest';
import { ProviderRegistry } from './acp-provider-registry.js';
import { noopLogger } from '../logger.js';
import { providers, registrySnapshots, systemSettings } from '../db/schema.js';
import { createDatabase } from '../db/index.js';
import { eq } from 'drizzle-orm';

interface RegistryInternal {
  fetchRegistryWithCache(): Promise<{ agents: RegistryAgent[]; source: 'remote' | 'cache' }>;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

test('ProviderRegistry sync handles 304 Not Modified', async () => {
  const db = createDatabase(':memory:');
  const mockAgents: RegistryAgent[] = [
    {
      id: 'claude-acp',
      name: 'Claude',
      version: '1.0.0',
      description: 'test',
      distribution: { npx: { package: 'p', args: [], env: {} } },
      authors: [],
    },
  ];
  
  await db.insert(registrySnapshots).values({
    data: JSON.stringify({ agents: mockAgents }),
    etag: 'W/"123"',
    lastModified: 'Wed, 20 May 2026 19:17:08 GMT',
    fetchedAt: new Date(),
  });

  let capturedHeaders: HeadersInit | undefined;
  vi.spyOn(global, 'fetch').mockImplementation((_input, init) => {
    capturedHeaders = init?.headers;
    return Promise.resolve(new Response(null, { status: 304 }));
  });

  const registry = new ProviderRegistry(db, noopLogger);
  const registryInternal = registry as unknown as RegistryInternal;
  await registryInternal.fetchRegistryWithCache();

  const headers = capturedHeaders as Record<string, string>;
  assert.equal(headers['If-None-Match'], 'W/"123"');
});

test('ProviderRegistry sync falls back to cache on fetch error', async () => {
  const db = createDatabase(':memory:');
  const mockAgents: RegistryAgent[] = [
    {
      id: 'claude-acp',
      name: 'Claude',
      version: '1.0.0',
      description: 'test',
      distribution: { npx: { package: 'p', args: [], env: {} } },
      authors: [],
    },
  ];

  await db.insert(registrySnapshots).values({
    data: JSON.stringify({ agents: mockAgents }),
    fetchedAt: new Date(),
  });

  const fetchSpy = vi.spyOn(global, 'fetch');
  fetchSpy.mockRejectedValue(new Error('Network error'));

  const registry = new ProviderRegistry(db, noopLogger);
  const registryInternal = registry as unknown as RegistryInternal;
  const result = await registryInternal.fetchRegistryWithCache();

  assert.equal(result.agents.length, 1);
  assert.equal(result.source, 'cache');
});

test('ProviderRegistry discover does not recurse forever when sync yields no providers', async () => {
  const db = createDatabase(':memory:');
  const registry = new ProviderRegistry(db, noopLogger);
  
  // mock sync to do nothing
  registry.sync = vi.fn().mockResolvedValue(undefined);

  const providersList = await registry.discover();

  assert.deepEqual(providersList, []);
  // eslint-disable-next-line @typescript-eslint/unbound-method
  assert.equal(vi.mocked(registry.sync).mock.calls.length, 1);
});

test('ProviderRegistry sync prunes older registry snapshots after a refresh', async () => {
  const db = createDatabase(':memory:');
  const mockAgents: RegistryAgent[] = [
    {
      id: 'claude-acp',
      name: 'Claude',
      version: '1.0.0',
      description: 'test',
      distribution: { npx: { package: 'p', args: [], env: {} } },
      authors: [],
    },
  ];

  // Insert old snapshot
  await db.insert(registrySnapshots).values({
    id: 1,
    data: JSON.stringify({ agents: [] }),
    etag: null,
    lastModified: null,
    fetchedAt: new Date(),
  });

  const fetchSpy = vi.spyOn(global, 'fetch');
  fetchSpy.mockResolvedValue(new Response(JSON.stringify({ agents: mockAgents }), { status: 200 }));

  const registry = new ProviderRegistry(db, noopLogger);
  const registryInternal = registry as unknown as RegistryInternal;
  const result = await registryInternal.fetchRegistryWithCache();

  assert.equal(result.source, 'remote');

  // Verify only newest snapshot exists (should delete snapshot with id 1)
  const remainingSnapshots = await db.select().from(registrySnapshots);
  assert.equal(remainingSnapshots.length, 1);
  assert.equal(remainingSnapshots[0].id, 2);
});

test('ProviderRegistry sync does not hydrate any providers on startup', async () => {
  const db = createDatabase(':memory:');
  const registryAgents: RegistryAgent[] = [
    {
      id: 'claude-acp',
      name: 'Claude',
      version: '1.0.0',
      description: 'test',
      distribution: { npx: { package: 'p', args: [], env: {} } },
      authors: [],
    },
    {
      id: 'codex-acp',
      name: 'Codex',
      version: '1.0.0',
      description: 'test',
      distribution: { npx: { package: 'q', args: [], env: {} } },
      authors: [],
    },
  ];

  await db.insert(registrySnapshots).values({
    data: JSON.stringify({ agents: registryAgents }),
    etag: null,
    lastModified: null,
    fetchedAt: new Date(),
  });

  const fetchSpy = vi.spyOn(global, 'fetch');
  fetchSpy.mockResolvedValue(
    new Response(JSON.stringify({ agents: registryAgents }), { status: 200 }),
  );

  const probeSpy = vi.spyOn(ProviderRegistry.prototype, 'probeAgent').mockResolvedValue({
    id: 'claude-acp',
    label: 'Claude',
    status: 'ready',
    command: 'npx',
    enabled: false,
    launchArgs: ['-y', 'p'],
    launchEnv: {},
    customEnv: {},
    configOptions: [],
    authMethods: [],
    version: '1.0.0',
    description: 'test',
    icon: undefined,
    supportsDynamicModel: false,
    supportsDynamicConfig: false,
  });

  const registry = new ProviderRegistry(db, noopLogger);
  await registry.sync();

  assert.equal(probeSpy.mock.calls.length, 0);
});

test('ProviderRegistry sync hydrates the saved default provider on startup', async () => {
  const db = createDatabase(':memory:');
  const registryAgents: RegistryAgent[] = [
    {
      id: 'claude-acp',
      name: 'Claude',
      version: '1.0.0',
      description: 'test',
      distribution: { npx: { package: 'p', args: [], env: {} } },
      authors: [],
    },
    {
      id: 'codex-acp',
      name: 'Codex',
      version: '1.0.0',
      description: 'test',
      distribution: { npx: { package: 'q', args: [], env: {} } },
      authors: [],
    },
  ];

  await db.insert(systemSettings).values({
    key: 'defaultProviderId',
    value: 'claude-acp',
  });

  await db.insert(providers).values({
    id: 'claude-acp',
    name: 'Claude',
    status: 'inactive',
    command: 'npx',
    enabled: true,
    launchArgs: JSON.stringify(['-y', 'p']),
    launchEnv: '{}',
    customEnv: '{}',
    configOptions: '[]',
    authMethods: '[]',
    version: '1.0.0',
    description: 'test',
    icon: null,
    supportsDynamicModel: false,
    supportsDynamicConfig: false,
  });

  const fetchSpy = vi.spyOn(global, 'fetch');
  fetchSpy.mockResolvedValue(
    new Response(JSON.stringify({ agents: registryAgents }), { status: 200 }),
  );

  const probeSpy = vi.spyOn(ProviderRegistry.prototype, 'probeAgent').mockResolvedValue({
    id: 'claude-acp',
    label: 'Claude',
    status: 'ready',
    command: 'npx',
    enabled: true,
    launchArgs: ['-y', 'p'],
    launchEnv: {},
    customEnv: {},
    configOptions: [],
    authMethods: [],
    version: '1.0.0',
    description: 'test',
    icon: undefined,
    supportsDynamicModel: false,
    supportsDynamicConfig: false,
  });

  const registry = new ProviderRegistry(db, noopLogger);
  await registry.sync();

  assert.equal(probeSpy.mock.calls.length, 1);
  assert.equal(probeSpy.mock.calls[0]?.[0].id, 'claude-acp');
});

test('ProviderRegistry sync prunes stale local gemini rows and clears stale defaults', async () => {
  const db = createDatabase(':memory:');
  const registryAgents: RegistryAgent[] = [
    {
      id: 'gemini',
      name: 'Gemini CLI',
      version: '0.42.0',
      description: "Google's official CLI for Gemini",
      distribution: { npx: { package: '@google/gemini-cli', args: [], env: {} } },
      authors: [],
    },
  ];

  await db.insert(systemSettings).values({
    key: 'defaultProviderId',
    value: 'gemini-cli',
  });

  await db.insert(providers).values({
    id: 'gemini',
    name: 'Gemini CLI',
    status: 'ready',
    command: 'npx',
    enabled: false,
    launchArgs: JSON.stringify(['-y', '@google/gemini-cli']),
    launchEnv: '{}',
    customEnv: '{}',
    configOptions: '[]',
    authMethods: '[]',
    version: '0.42.0',
    description: "Google's official CLI for Gemini",
    supportsDynamicModel: false,
    supportsDynamicConfig: false,
  });

  await db.insert(providers).values({
    id: 'gemini-cli',
    name: 'Gemini CLI (Local)',
    status: 'ready',
    command: 'gemini',
    enabled: false,
    launchArgs: JSON.stringify([]),
    launchEnv: '{}',
    customEnv: '{}',
    configOptions: '[]',
    authMethods: '[]',
    version: 'local',
    description: 'Local installation',
    supportsDynamicModel: false,
    supportsDynamicConfig: false,
  });

  const fetchSpy = vi.spyOn(global, 'fetch');
  fetchSpy.mockResolvedValue(
    new Response(JSON.stringify({ agents: registryAgents }), { status: 200 }),
  );

  const registry = new ProviderRegistry(db, noopLogger);
  await registry.sync();

  // Verify gemini-cli was deleted because it's not in supported agents list or registry
  const remainingProviders = await db.select().from(providers);
  assert.equal(remainingProviders.length, 1);
  assert.equal(remainingProviders[0].id, 'gemini');

  // Verify stale default settings cleared
  const defaultSetting = await db
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.key, 'defaultProviderId'));
  assert.equal(defaultSetting[0].value, '');
});

test('ProviderRegistry setProviderConfig updates database and triggers dynamic probe', async () => {
  const db = createDatabase(':memory:');
  const providerRow = {
    id: 'claude-acp',
    name: 'Claude',
    status: 'inactive' as const,
    command: 'npx',
    enabled: true,
    launchArgs: JSON.stringify(['-y', 'p']),
    launchEnv: '{}',
    customEnv: '{}',
    configOptions: '[]',
    authMethods: '[]',
    version: '1.0.0',
    description: 'test',
    supportsDynamicModel: false,
    supportsDynamicConfig: false,
  };

  await db.insert(providers).values(providerRow);

  const probeSpy = vi.spyOn(ProviderRegistry.prototype, 'probeAgent').mockResolvedValue({
    id: 'claude-acp',
    label: 'Claude',
    status: 'ready',
    command: 'npx',
    enabled: true,
    launchArgs: ['-y', 'p'],
    launchEnv: {},
    customEnv: { ANTHROPIC_API_KEY: 'test-key' },
    configOptions: [],
    authMethods: [],
    version: '1.0.0',
    description: 'test',
    icon: undefined,
    supportsDynamicModel: false,
    supportsDynamicConfig: false,
  });

  const registry = new ProviderRegistry(db, noopLogger);
  const result = await registry.setProviderConfig('claude-acp', { ANTHROPIC_API_KEY: 'test-key' });

  // Verify database has customEnv updated
  const updatedRow = await db.select().from(providers).where(eq(providers.id, 'claude-acp'));
  assert.deepEqual(JSON.parse(updatedRow[0].customEnv || '{}'), { ANTHROPIC_API_KEY: 'test-key' });
  
  assert.equal(probeSpy.mock.calls.length, 1);
  assert.deepEqual(probeSpy.mock.calls[0][1].env, { ANTHROPIC_API_KEY: 'test-key' });
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.customEnv, { ANTHROPIC_API_KEY: 'test-key' });
});
