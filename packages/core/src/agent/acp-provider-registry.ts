import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { desc, eq, lt } from 'drizzle-orm';
import type { ACPConfigOption, AuthMethod, ProviderDiscovery, RegistryAgent } from '@agentctl/shared';
import { type Logger, noopLogger } from '../logger.js';
import { createAgentConnection } from './acp-transport.js';
import { notFoundEntry, probeAgent } from './acp-probe.js';
import { providers, registrySnapshots, systemSettings } from '../db/schema.js';
import type { DbClient } from './acp-session.js';
import { Provider, type ProviderData } from './provider.js';

const REGISTRY_URL = 'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json';
const SUPPORTED_AGENTS = new Set(['opencode', 'claude-acp', 'codex-acp', 'gemini']);

type RegistrySnapshotRow = typeof registrySnapshots.$inferSelect;
interface LaunchConfig {
	command: string;
	args: string[];
	env: Record<string, string>;
}

interface ProviderSettings {
	onboardingCompleted?: string;
	onboardingVersion?: string;
	setupStep?: string;
	defaultProviderId?: string;
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
	existing: ProviderData | undefined,
): ProviderDiscovery {
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

export class ProviderRegistry {
	private syncInFlight: Promise<void> | null = null;

	constructor(
		private db: DbClient,
		private logger: Logger = noopLogger,
	) { }

	async discover(): Promise<ProviderDiscovery[]> {
		const rows = await this.db.select().from(providers);

		if (rows.length === 0) {
			this.logger.info('Registry is empty, performing initial sync...');
			await this.sync();

			const syncedRows = await this.db.select().from(providers);
			if (syncedRows.length === 0) {
				this.logger.warn('Provider registry sync completed without any discoverable providers');
				return [];
			}

			return syncedRows.map((row) => new Provider(row).toDiscovery());
		}

		return rows.map((row) => new Provider(row).toDiscovery());
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

	private async getProviderRow(id: string): Promise<ProviderData | undefined> {
		const rows = await this.db.select().from(providers).where(eq(providers.id, id));
		return rows[0];
	}

	private async persistProvider(provider: ProviderDiscovery): Promise<void> {
		const enabled = provider.enabled;

		await this.db
			.insert(providers)
			.values({
				id: provider.id,
				name: provider.label,
				status: provider.status,
				command: provider.command,
				enabled,
				launchArgs: JSON.stringify(provider.launchArgs),
				launchEnv: JSON.stringify(provider.launchEnv),
				customEnv: JSON.stringify(provider.customEnv),
				configOptions: JSON.stringify(provider.configOptions ?? []),
				authMethods: JSON.stringify(provider.authMethods),
				version: provider.version,
				description: provider.description,
				icon: provider.icon,
				supportsDynamicModel: provider.supportsDynamicModel,
				supportsDynamicConfig: provider.supportsDynamicConfig,
			})
			.onConflictDoUpdate({
				target: providers.id,
				set: {
					name: provider.label,
					status: provider.status,
					command: provider.command,
					enabled,
					launchArgs: JSON.stringify(provider.launchArgs),
					launchEnv: JSON.stringify(provider.launchEnv),
					customEnv: JSON.stringify(provider.customEnv),
					configOptions: JSON.stringify(provider.configOptions ?? []),
					authMethods: JSON.stringify(provider.authMethods),
					version: provider.version,
					description: provider.description,
					icon: provider.icon,
					supportsDynamicModel: provider.supportsDynamicModel,
					supportsDynamicConfig: provider.supportsDynamicConfig,
					updatedAt: new Date(),
				},
			});
	}

	private async pickWarmProviderId(
		existingRows: ProviderData[],
		supportedRegistry: RegistryAgent[],
	): Promise<string | null> {
		const settings = await this.getSettings();
		const preferredIds = [settings.defaultProviderId, ...existingRows.filter((row) => row.enabled).map((row) => row.id)].filter(
			(id): id is string => id !== undefined && id !== '',
		);

		for (const providerId of preferredIds) {
			if (supportedRegistry.some((agent) => agent.id === providerId)) {
				return providerId;
			}
		}

		return null;
	}

	async ensureProviderReady(
		providerId: string,
		options: { force?: boolean } = {},
	): Promise<Provider> {
		const force = options.force ?? false;
		let row = await this.getProviderRow(providerId);

		if (!row) {
			await this.sync();
			row = await this.getProviderRow(providerId);
		}

		if (!row) {
			throw new Error(`Provider ${providerId} not found`);
		}

		const provider = new Provider(row);

		if (!force && (row.status === 'ready' || row.status === 'needs_auth')) {
			if (row.command !== 'npx' && row.command !== 'uvx' && !isBinaryOnPath(row.command)) {
				this.logger.warn(`Binary missing for provider ${providerId}: ${row.command}`);
				await this.db
					.update(providers)
					.set({ status: 'not_found', updatedAt: new Date() })
					.where(eq(providers.id, providerId));
				return new Provider({ ...row, status: 'not_found' });
			} else {
				return provider;
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
		await this.persistProvider(probeResult);

		const updatedRow = await this.getProviderRow(providerId);
		if (!updatedRow) {
			throw new Error(`Provider ${providerId} vanished after probe`);
		}
		return new Provider(updatedRow);
	}

	async sync(): Promise<void> {
		if (this.syncInFlight) {
			this.logger.debug('Provider registry sync already in progress, waiting for existing sync');
			return this.syncInFlight;
		}

		this.syncInFlight = this.runSync().finally(() => {
			this.syncInFlight = null;
		});

		return this.syncInFlight;
	}

	private async runSync(): Promise<void> {
		this.logger.info('Starting provider discovery and sync...');
		const { agents: registryAgents } = await this.fetchRegistryWithCache();
		const supportedRegistry = registryAgents.filter((agent) => SUPPORTED_AGENTS.has(agent.id));

		const existingRows = await this.db.select().from(providers);
		const warmProviderId = await this.pickWarmProviderId(existingRows, supportedRegistry);
		const supportedIds = new Set(supportedRegistry.map((agent) => agent.id));
		const existingMap = new Map(existingRows.map((row) => [row.id, row]));

		for (const agent of supportedRegistry) {
			const existing = existingMap.get(agent.id);
			const launch = resolveLaunchConfig(agent);
			const discovery = buildSyncedDiscovery(agent, launch, existing);

			await this.persistProvider(discovery);

			if (warmProviderId === agent.id && discovery.status !== 'not_found') {
				this.logger.info(`Hydrating selected provider: ${agent.id}`);
				await this.ensureProviderReady(agent.id);
			}
		}

		const obsoleteRows = existingRows.filter((row) => !supportedIds.has(row.id));
		for (const row of obsoleteRows) {
			await this.db.delete(providers).where(eq(providers.id, row.id));
		}

		const settings = await this.getSettings();
		if (settings.defaultProviderId && !supportedIds.has(settings.defaultProviderId)) {
			await this.updateSetting('defaultProviderId', '');
		}

		this.logger.info(`Sync complete. Persisted ${String(supportedRegistry.length)} providers.`);
	}

	async getProvider(id: string): Promise<Provider | undefined> {
		const row = await this.getProviderRow(id);
		if (!row) return undefined;
		return new Provider(row);
	}

	async refreshProvider(providerId: string): Promise<ProviderDiscovery> {
		const provider = await this.ensureProviderReady(providerId, { force: true });
		return provider.toDiscovery();
	}

	async login(
		providerId: string,
		methodId: string,
		params: Record<string, unknown> = {},
	): Promise<void> {
		const provider = await this.ensureProviderReady(providerId, { force: true });
		const discovery = provider.toDiscovery();

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
				.update(providers)
				.set({ status: 'ready', enabled: true, updatedAt: new Date() })
				.where(eq(providers.id, providerId));
		} finally {
			child.kill();
		}
	}

	async activate(providerId: string): Promise<ProviderDiscovery> {
		const provider = await this.ensureProviderReady(providerId, { force: true });
		if (!provider.enabled) {
			return await this.setProviderEnabled(providerId, true);
		}
		return provider.toDiscovery();
	}

	async getSettings(): Promise<ProviderSettings> {
		const rows = await this.db.select().from(systemSettings);
		const settings: ProviderSettings = {};
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
				case 'defaultProviderId':
					settings.defaultProviderId = row.value;
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

	async setProviderEnabled(providerId: string, enabled: boolean): Promise<ProviderDiscovery> {
		const row = await this.getProviderRow(providerId);
		if (!row) {
			throw new Error(`Provider ${providerId} not found`);
		}

		await this.db
			.update(providers)
			.set({ enabled, updatedAt: new Date() })
			.where(eq(providers.id, providerId));

		return new Provider({ ...row, enabled }).toDiscovery();
	}

	async setProviderConfig(providerId: string, customEnv: Record<string, string>): Promise<ProviderDiscovery> {
		const row = await this.getProviderRow(providerId);
		if (!row) {
			throw new Error(`Provider ${providerId} not found`);
		}

		await this.db
			.update(providers)
			.set({
				customEnv: JSON.stringify(customEnv),
				updatedAt: new Date(),
			})
			.where(eq(providers.id, providerId));

		const provider = await this.ensureProviderReady(providerId, { force: true });
		return provider.toDiscovery();
	}

	startBackgroundWarmup(): void {
		this.logger.info('Starting background provider warmup...');
		void (async () => {
			try {
				const allProviders = await this.db.select().from(providers);
				const settings = await this.getSettings();
				const targets = allProviders.filter(
					(p) => p.status === 'inactive' && (p.enabled || p.id === settings.defaultProviderId)
				);

				for (const p of targets) {
					this.logger.info(`Background probing provider: ${p.id}`);
					try {
						await this.ensureProviderReady(p.id, { force: true });
					} catch (err) {
						this.logger.error(err, `Failed background warmup for provider ${p.id}`);
					}
				}
			} catch (err) {
				this.logger.error(err, 'Failed background provider warmup scan');
			}
		})();
	}
}
