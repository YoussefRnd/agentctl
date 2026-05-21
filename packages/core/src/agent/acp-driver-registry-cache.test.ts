import assert from 'node:assert/strict';
import type { RegistryAgent } from '@agentctl/shared';
import { beforeEach, test, vi } from 'vitest';
import { DriverRegistry } from './acp-driver-registry.js';
import * as probeModule from './acp-probe.js';
import { noopLogger } from '../logger.js';
import { drivers, registrySnapshots, systemSettings } from '../db/schema.js';
import type { DbClient } from './acp-session.js';





interface RegistryInternal {
	fetchRegistryWithCache(): Promise<{ agents: RegistryAgent[]; source: 'remote' | 'cache' }>;
}

beforeEach(() => {
	vi.restoreAllMocks();
});

test('DriverRegistry sync handles 304 Not Modified', async () => {
	const mockAgents: RegistryAgent[] = [{
		id: 'claude-acp',
		name: 'Claude',
		version: '1.0.0',
		description: 'test',
		distribution: { npx: { package: 'p', args: [], env: {} } },
		authors: [],
	}];
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

	const registry = new DriverRegistry(db, noopLogger);
	const registryInternal = registry as unknown as RegistryInternal;
	await registryInternal.fetchRegistryWithCache();

	const headers = capturedHeaders as Record<string, string>;
	assert.equal(headers['If-None-Match'], 'W/"123"');
});

test('DriverRegistry sync falls back to cache on fetch error', async () => {
	const mockAgents: RegistryAgent[] = [{
		id: 'claude-acp',
		name: 'Claude',
		version: '1.0.0',
		description: 'test',
		distribution: { npx: { package: 'p', args: [], env: {} } },
		authors: [],
	}];
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

	const registry = new DriverRegistry(db, noopLogger);
	const registryInternal = registry as unknown as RegistryInternal;
	const result = await registryInternal.fetchRegistryWithCache();

	assert.equal(result.agents.length, 1);
	assert.equal(result.source, 'cache');
});

test('DriverRegistry discover does not recurse forever when sync yields no drivers', async () => {
	const selectFrom = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]);
	const sync = vi.fn().mockResolvedValue(undefined);

	const db = {
		select: vi.fn().mockReturnValue({
			from: selectFrom,
		}),
	} as unknown as DbClient;

	const registry = new DriverRegistry(db, noopLogger);
	registry.sync = sync;

	const drivers = await registry.discover();

	assert.deepEqual(drivers, []);
	assert.equal(sync.mock.calls.length, 1);
	assert.equal(selectFrom.mock.calls.length, 2);
});

test('DriverRegistry sync prunes older registry snapshots after a refresh', async () => {
	const mockAgents: RegistryAgent[] = [{
		id: 'claude-acp',
		name: 'Claude',
		version: '1.0.0',
		description: 'test',
		distribution: { npx: { package: 'p', args: [], env: {} } },
		authors: [],
	}];
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

	const registry = new DriverRegistry(db, noopLogger);
	const registryInternal = registry as unknown as RegistryInternal;
	const result = await registryInternal.fetchRegistryWithCache();

	assert.equal(result.source, 'remote');
	assert.equal(insertValues.mock.calls.length, 1);
	assert.equal(deleteWhere.mock.calls.length, 1);
});

test('DriverRegistry sync does not hydrate any providers on startup', async () => {
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

	let driverSelectCount = 0;
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

		if (table === drivers) {
			driverSelectCount += 1;
			if (driverSelectCount === 1) {
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
	fetchSpy.mockResolvedValue(new Response(JSON.stringify({ agents: registryAgents }), { status: 200 }));

	const probeSpy = vi.spyOn(probeModule, 'probeAgent').mockResolvedValue({
		id: 'claude-acp',
		label: 'Claude',
		status: 'ready',
		command: 'npx',
		enabled: false,
		launchArgs: ['-y', 'p'],
		launchEnv: {},
		configOptions: [],
		authMethods: [],
		version: '1.0.0',
		description: 'test',
		icon: undefined,
	});

	const registry = new DriverRegistry(db, noopLogger);
	await registry.sync();

	assert.equal(probeSpy.mock.calls.length, 0);
});

test('DriverRegistry sync hydrates the saved default driver on startup', async () => {
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

	const systemSettingsRows = [{ key: 'defaultDriverId', value: 'claude-acp' }];
	const insertValues = vi.fn().mockReturnValue({
		onConflictDoUpdate: vi.fn().mockResolvedValue({}),
	});
	let driverSelectCount = 0;
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

		if (table === drivers) {
			driverSelectCount += 1;
			if (driverSelectCount === 1) {
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
	fetchSpy.mockResolvedValue(new Response(JSON.stringify({ agents: registryAgents }), { status: 200 }));

	const probeSpy = vi.spyOn(probeModule, 'probeAgent').mockResolvedValue({
		id: 'claude-acp',
		label: 'Claude',
		status: 'ready',
		command: 'npx',
		enabled: true,
		launchArgs: ['-y', 'p'],
		launchEnv: {},
		configOptions: [],
		authMethods: [],
		version: '1.0.0',
		description: 'test',
		icon: undefined,
	});

	const registry = new DriverRegistry(db, noopLogger);
	await registry.sync();

	assert.equal(probeSpy.mock.calls.length, 1);
	assert.equal(probeSpy.mock.calls[0]?.[0].id, 'claude-acp');
});
