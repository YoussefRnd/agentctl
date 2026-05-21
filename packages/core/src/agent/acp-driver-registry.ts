import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { desc, eq, lt } from 'drizzle-orm';
import type { ACPConfigOption, AuthMethod, DriverDiscovery, RegistryAgent } from '@agentctl/shared';
import { type Logger, noopLogger } from '../logger.js';
import { createAgentConnection } from './acp-transport.js';
import { notFoundEntry, probeAgent } from './acp-probe.js';
import { drivers, registrySnapshots, systemSettings } from '../db/schema.js';
import type { DbClient } from './acp-session.js';
import { Driver, type DriverData } from './driver.js';

const REGISTRY_URL = 'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json';
const SUPPORTED_AGENTS = new Set(['opencode', 'claude-acp', 'codex-acp', 'gemini']);

type RegistrySnapshotRow = typeof registrySnapshots.$inferSelect;
interface LaunchConfig {
	command: string;
	args: string[];
	env: Record<string, string>;
}

interface DriverSettings {
	onboardingCompleted?: string;
	onboardingVersion?: string;
	setupStep?: string;
	defaultDriverId?: string;
}

function parseJSON<T>(value: string | null | undefined, fallback: T): T {
	if (!value) return fallback;
	try {
		return JSON.parse(value) as T;
	} catch {
		return fallback;
	}
}

function isBinaryOnPath(command: string): boolean {
	try {
		const checkCmd = os.platform() === 'win32' ? `where ${command}` : `which ${command}`;
		execSync(checkCmd, { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
}

function getPlatformKey(): string {
	const arch = os.arch();
	const platform = os.platform();

	const archMap: Record<string, string> = {
		x64: 'x86_64',
		arm64: 'aarch64',
		aarch64: 'aarch64',
	};

	const platformMap: Record<string, string> = {
		darwin: 'darwin',
		linux: 'linux',
		win32: 'windows',
	};

	const normalizedArch = archMap[arch] ?? arch;
	const normalizedPlatform = platformMap[platform] ?? platform;

	return `${normalizedPlatform}-${normalizedArch}`;
}

function resolveLaunchConfig(
	agent: RegistryAgent,
): LaunchConfig | null {
	const platform = getPlatformKey();

	const binaryTarget = agent.distribution.binary?.[platform];
	if (binaryTarget) {
		let command = binaryTarget.cmd;
		let exists = false;

		if (command.startsWith('./')) {
			if (fs.existsSync(command)) {
				exists = true;
			} else {
				const pathCmd = command.substring(2);
				if (isBinaryOnPath(pathCmd)) {
					command = pathCmd;
					exists = true;
				}
			}
		} else {
			exists = isBinaryOnPath(command);
		}

		if (exists) {
			return {
				command,
				args: [...(binaryTarget.args ?? [])],
				env: binaryTarget.env,
			};
		}
	}

	if (agent.distribution.npx) {
		const { package: pkg, args, env } = agent.distribution.npx;
		return {
			command: 'npx',
			args: ['-y', pkg, ...(args ?? [])],
			env,
		};
	}

	if (agent.distribution.uvx) {
		const { package: pkg, args, env } = agent.distribution.uvx;
		return {
			command: 'uvx',
			args: [pkg, ...(args ?? [])],
			env,
		};
	}

	return null;
}

function buildSyncedDiscovery(
	agent: RegistryAgent,
	launch: LaunchConfig | null,
	existing: DriverData | undefined,
): DriverDiscovery {
	const existingIsActive = existing?.status === 'ready' || existing?.status === 'needs_auth';
	const command = launch?.command ?? existing?.command ?? agent.id;
	const launchArgs = parseJSON(existing?.launchArgs, [] as string[]);
	const launchEnv = parseJSON(existing?.launchEnv, {});
	const customEnv = parseJSON(existing?.customEnv, {});
	const configOptions = parseJSON(existing?.configOptions, [] as ACPConfigOption[]);
	const authMethods = parseJSON(existing?.authMethods, [] as AuthMethod[]);
	const enabled = existing ? existing.enabled : false;
	const supportsDynamicModel = existing ? existing.supportsDynamicModel : false;
	const supportsDynamicConfig = existing ? existing.supportsDynamicConfig : false;

	if (!launch && !existing) {
		return notFoundEntry(agent, enabled);
	}

	return {
		id: agent.id,
		label: agent.name,
		status: existingIsActive ? existing.status : launch ? 'inactive' : 'not_found',
		command,
		enabled,
		launchArgs,
		launchEnv,
		customEnv,
		configOptions,
		authMethods,
		version: agent.version,
		description: agent.description,
		icon: agent.icon,
		supportsDynamicModel,
		supportsDynamicConfig,
	};
}

function parseRegistryAgents(data: string): RegistryAgent[] {
	const parsed = JSON.parse(data) as { agents: RegistryAgent[] };
	return parsed.agents;
}

export class DriverRegistry {
	private syncInFlight: Promise<void> | null = null;

	constructor(
		private db: DbClient,
		private logger: Logger = noopLogger,
	) { }

	async discover(): Promise<DriverDiscovery[]> {
		const rows = await this.db.select().from(drivers);

		if (rows.length === 0) {
			this.logger.info('Registry is empty, performing initial sync...');
			await this.sync();

			const syncedRows = await this.db.select().from(drivers);
			if (syncedRows.length === 0) {
				this.logger.warn('Driver registry sync completed without any discoverable drivers');
				return [];
			}

			return syncedRows.map((row) => new Driver(row).toDiscovery());
		}

		return rows.map((row) => new Driver(row).toDiscovery());
	}

	private async loadLatestSnapshot(): Promise<RegistrySnapshotRow | undefined> {
		const snapshots = await this.db
			.select()
			.from(registrySnapshots)
			.orderBy(desc(registrySnapshots.id))
			.limit(1);

		return snapshots[0];
	}

	private async persistSnapshot(data: {
		agents: RegistryAgent[];
		etag: string | null;
		lastModified: string | null;
	}): Promise<void> {
		await this.db.insert(registrySnapshots).values({
			data: JSON.stringify(data),
			etag: data.etag,
			lastModified: data.lastModified,
			fetchedAt: new Date(),
		});

		const latestSnapshot = await this.loadLatestSnapshot();
		if (!latestSnapshot) return;

		await this.db.delete(registrySnapshots).where(lt(registrySnapshots.id, latestSnapshot.id));
	}

	private async fetchRegistryWithCache(): Promise<{
		agents: RegistryAgent[];
		source: 'remote' | 'cache';
	}> {
		const lastSnapshot = await this.loadLatestSnapshot();

		const headers: Record<string, string> = {};
		if (lastSnapshot?.etag) headers['If-None-Match'] = lastSnapshot.etag;
		if (lastSnapshot?.lastModified) headers['If-Modified-Since'] = lastSnapshot.lastModified;

		try {
			const response = await fetch(REGISTRY_URL, { headers });

			if (response.status === 304 && lastSnapshot) {
				this.logger.info('Registry unchanged (304), using cached snapshot');
				return { agents: parseRegistryAgents(lastSnapshot.data), source: 'cache' };
			}

			if (!response.ok) {
				throw new Error(`Failed to fetch registry: ${String(response.status)} ${response.statusText}`);
			}

			const data = (await response.json()) as { agents: RegistryAgent[] };
			await this.persistSnapshot({
				agents: data.agents,
				etag: response.headers.get('etag'),
				lastModified: response.headers.get('last-modified'),
			});

			return { agents: data.agents, source: 'remote' };
		} catch (err) {
			this.logger.warn(err, 'Failed to fetch remote registry, falling back to cache');
			if (lastSnapshot) {
				return { agents: parseRegistryAgents(lastSnapshot.data), source: 'cache' };
			}
			return { agents: [], source: 'cache' };
		}
	}

	private async getDriverRow(id: string): Promise<DriverData | undefined> {
		const rows = await this.db.select().from(drivers).where(eq(drivers.id, id));
		return rows[0];
	}

	private async persistDriver(driver: DriverDiscovery): Promise<void> {
		const enabled = driver.enabled;

		await this.db
			.insert(drivers)
			.values({
				id: driver.id,
				name: driver.label,
				status: driver.status,
				command: driver.command,
				enabled,
				launchArgs: JSON.stringify(driver.launchArgs),
				launchEnv: JSON.stringify(driver.launchEnv),
				customEnv: JSON.stringify(driver.customEnv),
				configOptions: JSON.stringify(driver.configOptions ?? []),
				authMethods: JSON.stringify(driver.authMethods),
				version: driver.version,
				description: driver.description,
				icon: driver.icon,
				supportsDynamicModel: driver.supportsDynamicModel,
				supportsDynamicConfig: driver.supportsDynamicConfig,
			})
			.onConflictDoUpdate({
				target: drivers.id,
				set: {
					name: driver.label,
					status: driver.status,
					command: driver.command,
					enabled,
					launchArgs: JSON.stringify(driver.launchArgs),
					launchEnv: JSON.stringify(driver.launchEnv),
					customEnv: JSON.stringify(driver.customEnv),
					configOptions: JSON.stringify(driver.configOptions ?? []),
					authMethods: JSON.stringify(driver.authMethods),
					version: driver.version,
					description: driver.description,
					icon: driver.icon,
					supportsDynamicModel: driver.supportsDynamicModel,
					supportsDynamicConfig: driver.supportsDynamicConfig,
					updatedAt: new Date(),
				},
			});
	}

	private async pickWarmDriverId(
		existingRows: DriverData[],
		supportedRegistry: RegistryAgent[],
	): Promise<string | null> {
		const settings = await this.getSettings();
		const preferredIds = [settings.defaultDriverId, ...existingRows.filter((row) => row.enabled).map((row) => row.id)].filter(
			(id): id is string => id !== undefined && id !== '',
		);

		for (const driverId of preferredIds) {
			if (supportedRegistry.some((agent) => agent.id === driverId)) {
				return driverId;
			}
		}

		return null;
	}

	async ensureDriverReady(
		driverId: string,
		options: { force?: boolean } = {},
	): Promise<Driver> {
		const force = options.force ?? false;
		let row = await this.getDriverRow(driverId);

		if (!row) {
			await this.sync();
			row = await this.getDriverRow(driverId);
		}

		if (!row) {
			throw new Error(`Driver ${driverId} not found`);
		}

		const driver = new Driver(row);

		if (!force && (row.status === 'ready' || row.status === 'needs_auth')) {
			if (row.command !== 'npx' && row.command !== 'uvx' && !isBinaryOnPath(row.command)) {
				this.logger.warn(`Binary missing for driver ${driverId}: ${row.command}`);
				await this.db
					.update(drivers)
					.set({ status: 'not_found', updatedAt: new Date() })
					.where(eq(drivers.id, driverId));
				// Update row status manually for returning the correct current state
				return new Driver({ ...row, status: 'not_found' });
			} else {
				return driver;
			}
		}

		const launch = {
			command: row.command,
			args: parseJSON(row.launchArgs, [] as string[]),
			env: {
				...parseJSON(row.launchEnv, {}),
				...parseJSON(row.customEnv, {}),
			},
		};

		const agentStub: RegistryAgent = {
			id: row.id,
			name: row.name,
			version: row.version ?? 'local',
			description: row.description ?? '',
			authors: [],
			distribution: {},
		};

		const probeResult = await probeAgent(agentStub, launch, this.logger);
		probeResult.enabled = row.enabled;
		probeResult.customEnv = parseJSON(row.customEnv, {});
		await this.persistDriver(probeResult);
		
		// Return updated driver
		const updatedRow = await this.getDriverRow(driverId);
		if (!updatedRow) {
			throw new Error(`Driver ${driverId} vanished after probe`);
		}
		return new Driver(updatedRow);
	}

	async sync(): Promise<void> {
		if (this.syncInFlight) {
			this.logger.debug('Driver registry sync already in progress, waiting for existing sync');
			return this.syncInFlight;
		}

		this.syncInFlight = this.runSync().finally(() => {
			this.syncInFlight = null;
		});

		return this.syncInFlight;
	}

	private async runSync(): Promise<void> {
		this.logger.info('Starting agent discovery and sync...');
		const { agents: registryAgents } = await this.fetchRegistryWithCache();
		const supportedRegistry = registryAgents.filter((agent) => SUPPORTED_AGENTS.has(agent.id));

		const existingRows = await this.db.select().from(drivers);
		const warmDriverId = await this.pickWarmDriverId(existingRows, supportedRegistry);
		const supportedIds = new Set(supportedRegistry.map((agent) => agent.id));
		const existingMap = new Map(existingRows.map((row) => [row.id, row]));

		for (const agent of supportedRegistry) {
			const existing = existingMap.get(agent.id);
			const launch = resolveLaunchConfig(agent);
			const discovery = buildSyncedDiscovery(agent, launch, existing);

			await this.persistDriver(discovery);

			if (warmDriverId === agent.id && discovery.status !== 'not_found') {
				this.logger.info(`Hydrating selected driver: ${agent.id}`);
				await this.ensureDriverReady(agent.id);
			}
		}

		const obsoleteRows = existingRows.filter((row) => !supportedIds.has(row.id));
		for (const row of obsoleteRows) {
			await this.db.delete(drivers).where(eq(drivers.id, row.id));
		}

		const settings = await this.getSettings();
		if (settings.defaultDriverId && !supportedIds.has(settings.defaultDriverId)) {
			await this.updateSetting('defaultDriverId', '');
		}

		this.logger.info(`Sync complete. Persisted ${String(supportedRegistry.length)} drivers.`);
	}

	async getDriver(id: string): Promise<Driver | undefined> {
		const row = await this.getDriverRow(id);
		if (!row) return undefined;
		return new Driver(row);
	}

	async refreshDriver(driverId: string): Promise<DriverDiscovery> {
		const driver = await this.ensureDriverReady(driverId, { force: true });
		return driver.toDiscovery();
	}

	async login(
		driverId: string,
		methodId: string,
		params: Record<string, unknown> = {},
	): Promise<void> {
		const driver = await this.ensureDriverReady(driverId, { force: true });
		const discovery = driver.toDiscovery();

		const { child, connection } = createAgentConnection(
			discovery.command,
			discovery.launchArgs,
			{
				...discovery.launchEnv,
				...discovery.customEnv,
			},
		);

		try {
			await connection.initialize({
				protocolVersion: 1,
				clientInfo: { name: 'agentctl-login', version: '1.0.0' },
			});

			await (connection.authenticate({
				methodId,
				_meta: params,
			}) as Promise<unknown>);

			await this.db
				.update(drivers)
				.set({ status: 'ready', enabled: true, updatedAt: new Date() })
				.where(eq(drivers.id, driverId));
		} finally {
			child.kill();
		}
	}

	async activate(driverId: string): Promise<DriverDiscovery> {
		const driver = await this.ensureDriverReady(driverId, { force: true });
		if (!driver.enabled) {
			return await this.setDriverEnabled(driverId, true);
		}
		return driver.toDiscovery();
	}

	async getSettings(): Promise<DriverSettings> {
		const rows = await this.db.select().from(systemSettings);
		const settings: DriverSettings = {};
		for (const row of rows) {
			switch (row.key) {
				case 'onboardingCompleted':
					settings.onboardingCompleted = row.value;
					break;
				case 'onboardingVersion':
					settings.onboardingVersion = row.value;
					break;
				case 'setupStep':
					settings.setupStep = row.value;
					break;
				case 'defaultDriverId':
					settings.defaultDriverId = row.value;
					break;
			}
		}
		return settings;
	}

	async updateSetting(key: string, value: string): Promise<void> {
		await this.db
			.insert(systemSettings)
			.values({
				key,
				value,
			})
			.onConflictDoUpdate({
				target: systemSettings.key,
				set: {
					value,
					updatedAt: new Date(),
				},
			});
	}

	async setDriverEnabled(driverId: string, enabled: boolean): Promise<DriverDiscovery> {
		const row = await this.getDriverRow(driverId);
		if (!row) {
			throw new Error(`Driver ${driverId} not found`);
		}

		await this.db
			.update(drivers)
			.set({ enabled, updatedAt: new Date() })
			.where(eq(drivers.id, driverId));

		return new Driver({ ...row, enabled }).toDiscovery();
	}

	async setDriverConfig(driverId: string, customEnv: Record<string, string>): Promise<DriverDiscovery> {
		const row = await this.getDriverRow(driverId);
		if (!row) {
			throw new Error(`Driver ${driverId} not found`);
		}

		await this.db
			.update(drivers)
			.set({
				customEnv: JSON.stringify(customEnv),
				updatedAt: new Date(),
			})
			.where(eq(drivers.id, driverId));

		const driver = await this.ensureDriverReady(driverId, { force: true });
		return driver.toDiscovery();
	}

	startBackgroundWarmup(): void {
		this.logger.info('Starting background driver warmup...');
		void (async () => {
			try {
				const allDrivers = await this.db.select().from(drivers);
				const settings = await this.getSettings();
				const targets = allDrivers.filter(
					(d) => d.status === 'inactive' && (d.enabled || d.id === settings.defaultDriverId)
				);
				
				for (const d of targets) {
					this.logger.info(`Background probing driver: ${d.id}`);
					try {
						await this.ensureDriverReady(d.id, { force: true });
					} catch (err) {
						this.logger.error(err, `Failed background warmup for driver ${d.id}`);
					}
				}
			} catch (err) {
				this.logger.error(err, 'Failed background driver warmup scan');
			}
		})();
	}
}
