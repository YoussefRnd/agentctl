import assert from 'node:assert/strict';
import type { RegistryAgent } from '@agentctl/shared';
import { beforeEach, test, vi } from 'vitest';
import { ProviderRegistry } from './acp-provider-registry.js';
import { noopLogger } from '../logger.js';
import { providers, registrySnapshots, systemSettings } from '../db/schema.js';
import type { DbClient } from './acp-session.js';

interface RegistryInternal {
  fetchRegistryWithCache(): Promise<{ agents: RegistryAgent[]; source: 'remote' | 'cache' }>;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

test('ProviderRegistry sync handles 304 Not Modified', async () => {
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
  const mockSnapshot = {
    data: JSON.stringify({ agents: mockAgents }),
    etag: 'W/"123"',
    lastModified: 'Wed, 20 May 2026 19:17:08 GMT',
    fetchedAt: new Date(),
  };

  const db = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([mockSnapshot]),
        }),
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue({}),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue({}),
    }),
  } as unknown as DbClient;

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
  const mockSnapshot = {
    data: JSON.stringify({ agents: mockAgents }),
    fetchedAt: new Date(),
  };

  const db = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([mockSnapshot]),
        }),
      }),
    }),
  } as unknown as DbClient;

  const fetchSpy = vi.spyOn(global, 'fetch');
  fetchSpy.mockRejectedValue(new Error('Network error'));

  const registry = new ProviderRegistry(db, noopLogger);
  const registryInternal = registry as unknown as RegistryInternal;
  const result = await registryInternal.fetchRegistryWithCache();

  assert.equal(result.agents.length, 1);
  assert.equal(result.source, 'cache');
});

test('ProviderRegistry discover does not recurse forever when sync yields no providers', async () => {
  const selectFrom = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]);
  const sync = vi.fn().mockResolvedValue(undefined);

  const db = {
    select: vi.fn().mockReturnValue({
      from: selectFrom,
    }),
  } as unknown as DbClient;

  const registry = new ProviderRegistry(db, noopLogger);
  registry.sync = sync;

  const providers = await registry.discover();

  assert.deepEqual(providers, []);
  assert.equal(sync.mock.calls.length, 1);
  assert.equal(selectFrom.mock.calls.length, 2);
});

test('ProviderRegistry sync prunes older registry snapshots after a refresh', async () => {
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
  const oldSnapshot = {
    id: 1,
    data: JSON.stringify({ agents: [] }),
    etag: null,
    lastModified: null,
    fetchedAt: new Date(),
  };
  const newSnapshot = {
    id: 2,
    data: JSON.stringify({ agents: mockAgents }),
    etag: null,
    lastModified: null,
    fetchedAt: new Date(),
  };

  const selectOrderBy = vi.fn().mockReturnValue({
    limit: vi.fn().mockResolvedValueOnce([oldSnapshot]).mockResolvedValueOnce([newSnapshot]),
  });
  const deleteWhere = vi.fn().mockResolvedValue({});
  const insertValues = vi.fn().mockResolvedValue({});

  const db = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        orderBy: selectOrderBy,
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: insertValues,
    }),
    delete: vi.fn().mockReturnValue({
      where: deleteWhere,
    }),
  } as unknown as DbClient;

  const fetchSpy = vi.spyOn(global, 'fetch');
  fetchSpy.mockResolvedValue(new Response(JSON.stringify({ agents: mockAgents }), { status: 200 }));

  const registry = new ProviderRegistry(db, noopLogger);
  const registryInternal = registry as unknown as RegistryInternal;
  const result = await registryInternal.fetchRegistryWithCache();

  assert.equal(result.source, 'remote');
  assert.equal(insertValues.mock.calls.length, 1);
  assert.equal(deleteWhere.mock.calls.length, 1);
});

test('ProviderRegistry sync does not hydrate any providers on startup', async () => {
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

  const snapshot = {
    data: JSON.stringify({ agents: registryAgents }),
    etag: null,
    lastModified: null,
    fetchedAt: new Date(),
  };

  const hydratedRow = {
    id: 'claude-acp',
    name: 'Claude',
    status: 'ready',
    command: 'npx',
    enabled: false,
    launchArgs: JSON.stringify(['-y', 'p']),
    launchEnv: '{}',
    configOptions: '[]',
    authMethods: '[]',
    version: '1.0.0',
    description: 'test',
    icon: null,
  };

  const insertValues = vi.fn().mockReturnValue({
    onConflictDoUpdate: vi.fn().mockResolvedValue({}),
  });

  let providerSelectCount = 0;
  const selectFrom = vi.fn((table: unknown) => {
    if (table === registrySnapshots) {
      return {
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([snapshot]),
        }),
      };
    }

    if (table === systemSettings) {
      return Promise.resolve([]);
    }

    if (table === providers) {
      providerSelectCount += 1;
      if (providerSelectCount === 1) {
        return [];
      }

      return {
        where: vi.fn().mockResolvedValue([hydratedRow]),
      };
    }

    return undefined;
  });

  const db = {
    select: vi.fn().mockReturnValue({
      from: selectFrom,
    }),
    insert: vi.fn().mockReturnValue({
      values: insertValues,
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue({}),
    }),
  } as unknown as DbClient;

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

  const snapshot = {
    data: JSON.stringify({ agents: registryAgents }),
    etag: null,
    lastModified: null,
    fetchedAt: new Date(),
  };

  const hydratedRow = {
    id: 'claude-acp',
    name: 'Claude',
    status: 'inactive',
    command: 'npx',
    enabled: true,
    launchArgs: JSON.stringify(['-y', 'p']),
    launchEnv: '{}',
    configOptions: '[]',
    authMethods: '[]',
    version: '1.0.0',
    description: 'test',
    icon: null,
  };

  const systemSettingsRows = [{ key: 'defaultProviderId', value: 'claude-acp' }];
  const insertValues = vi.fn().mockReturnValue({
    onConflictDoUpdate: vi.fn().mockResolvedValue({}),
  });
  let providerSelectCount = 0;
  const selectFrom = vi.fn((table: unknown) => {
    if (table === registrySnapshots) {
      return {
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([snapshot]),
        }),
      };
    }

    if (table === systemSettings) {
      return Promise.resolve(systemSettingsRows);
    }

    if (table === providers) {
      providerSelectCount += 1;
      if (providerSelectCount === 1) {
        return [];
      }

      return {
        where: vi.fn().mockResolvedValue([hydratedRow]),
      };
    }

    return undefined;
  });

  const db = {
    select: vi.fn().mockReturnValue({
      from: selectFrom,
    }),
    insert: vi.fn().mockReturnValue({
      values: insertValues,
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue({}),
    }),
  } as unknown as DbClient;

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

  const snapshot = {
    data: JSON.stringify({ agents: registryAgents }),
    etag: null,
    lastModified: null,
    fetchedAt: new Date(),
  };

  const rows = [
    {
      id: 'gemini',
      name: 'Gemini CLI',
      status: 'ready',
      command: 'npx',
      enabled: false,
      launchArgs: JSON.stringify(['-y', '@google/gemini-cli']),
      launchEnv: '{}',
      configOptions: '[]',
      authMethods: '[]',
      version: '0.42.0',
      description: "Google's official CLI for Gemini",
      icon: null,
    },
    {
      id: 'gemini-cli',
      name: 'Gemini CLI (Local)',
      status: 'ready',
      command: 'gemini',
      enabled: false,
      launchArgs: JSON.stringify([]),
      launchEnv: '{}',
      configOptions: '[]',
      authMethods: '[]',
      version: 'local',
      description: 'Local installation',
      icon: null,
    },
  ];

  let providerDeleteCount = 0;
  let snapshotDeleteCount = 0;
  let providerUpsertCount = 0;
  let settingsUpsertCount = 0;
  const selectFrom = vi.fn((table: unknown) => {
    if (table === registrySnapshots) {
      return {
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([snapshot]),
        }),
      };
    }

    if (table === systemSettings) {
      return Promise.resolve([{ key: 'defaultProviderId', value: 'gemini-cli' }]);
    }

    if (table === providers) {
      return Promise.resolve(rows);
    }

    return undefined;
  });

  const db = {
    select: vi.fn().mockReturnValue({
      from: selectFrom,
    }),
    insert: vi.fn().mockImplementation((table: unknown) => {
      if (table === providers) {
        return {
          values: () => ({
            onConflictDoUpdate: () => {
              providerUpsertCount += 1;
              return Promise.resolve({});
            },
          }),
        };
      }

      return {
        values: () => ({
          onConflictDoUpdate: () => {
            settingsUpsertCount += 1;
            return Promise.resolve({});
          },
        }),
      };
    }),
    delete: vi.fn().mockImplementation((table: unknown) => {
      if (table === providers) {
        return {
          where: () => {
            providerDeleteCount += 1;
            return Promise.resolve({});
          },
        };
      }

      return {
        where: () => {
          snapshotDeleteCount += 1;
          return Promise.resolve({});
        },
      };
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue({}),
      }),
    }),
  } as unknown as DbClient;

  const fetchSpy = vi.spyOn(global, 'fetch');
  fetchSpy.mockResolvedValue(
    new Response(JSON.stringify({ agents: registryAgents }), { status: 200 }),
  );

  const registry = new ProviderRegistry(db, noopLogger);
  await registry.sync();

  assert.equal(providerDeleteCount, 1);
  assert.equal(snapshotDeleteCount, 1);
  assert.equal(providerUpsertCount, 1);
  assert.equal(settingsUpsertCount, 1);
});

test('ProviderRegistry setProviderConfig updates database and triggers dynamic probe', async () => {
  const providerRow = {
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
  };

  const dbUpdateSet = vi.fn().mockReturnValue({
    where: vi.fn().mockResolvedValue({}),
  });

  let selectCount = 0;
  const db = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => {
          selectCount++;
          if (selectCount === 1) {
            return Promise.resolve([providerRow]);
          } else if (selectCount === 2) {
            return Promise.resolve([
              {
                ...providerRow,
                customEnv: JSON.stringify({ ANTHROPIC_API_KEY: 'test-key' }),
              },
            ]);
          } else {
            return Promise.resolve([
              {
                ...providerRow,
                status: 'ready',
                customEnv: JSON.stringify({ ANTHROPIC_API_KEY: 'test-key' }),
              },
            ]);
          }
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: dbUpdateSet,
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue({}),
      }),
    }),
  } as unknown as DbClient;

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

  assert.equal(dbUpdateSet.mock.calls.length, 1);
  const updatedFields = dbUpdateSet.mock.calls[0]?.[0] as Record<string, unknown>;
  assert.deepEqual(updatedFields.customEnv, JSON.stringify({ ANTHROPIC_API_KEY: 'test-key' }));
  assert.equal(probeSpy.mock.calls.length, 1);
  assert.deepEqual(probeSpy.mock.calls[0][1].env, { ANTHROPIC_API_KEY: 'test-key' });
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.customEnv, { ANTHROPIC_API_KEY: 'test-key' });
});
