import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { desc, eq, lt } from 'drizzle-orm';
import type {
  ACPConfigOption,
  AuthMethod,
  ProviderDiscovery,
  RegistryAgent,
} from '@agentctl/shared';
import { type Logger, noopLogger } from '../logger.js';
import type { AgentRuntime } from './acp-transport.js';
import { createAgentConnection, DefaultAgentRuntime, LegacyConnectionRuntimeAdapter } from './acp-transport.js';
import { providers, registrySnapshots, systemSettings } from '../db/schema.js';
import type { DbClient } from './acp-session.js';
import { Provider, type ProviderData } from './provider.js';

const REGISTRY_URL = 'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json';

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

export interface ProbeConnectionHandle {
  child: {
    on(event: 'error', listener: (error: unknown) => void): void;
    kill(): boolean;
  };
  connection: {
    initialize(params: {
      protocolVersion: number;
      clientInfo: { name: string; version: string };
    }): Promise<{
      authMethods?: { id: string; name: string }[];
    }>;
    newSession(params: { cwd: string; mcpServers: [] }): Promise<{
      configOptions?: ACPConfigOption[] | null;
    }>;
    closed: Promise<void>;
  };
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

function resolveLaunchConfig(agent: RegistryAgent): LaunchConfig | null {
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
  const launchArgs = launch?.args ?? parseJSON(existing?.launchArgs, [] as string[]);
  const launchEnv = launch?.env ?? parseJSON<Record<string, string>>(existing?.launchEnv, {});
  const customEnv = parseJSON<Record<string, string>>(existing?.customEnv, {});
  const configOptions = parseJSON(existing?.configOptions, [] as ACPConfigOption[]);
  const authMethods = parseJSON(existing?.authMethods, [] as AuthMethod[]);
  const enabled = existing ? existing.enabled : false;
  const supportsDynamicModel = existing ? existing.supportsDynamicModel : false;
  const supportsDynamicConfig = existing ? existing.supportsDynamicConfig : false;

  if (!launch && !existing) {
    return {
      id: agent.id,
      label: agent.name,
      status: 'not_found',
      command: agent.id,
      enabled,
      launchArgs: [],
      launchEnv: {},
      customEnv: {},
      authMethods: [],
      version: agent.version,
      description: agent.description,
      icon: agent.icon,
      supportsDynamicModel: false,
      supportsDynamicConfig: false,
    };
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
  private probesInFlight = new Map<string, Promise<Provider>>();
  private static readonly PROBE_TIMEOUT_MS = 60_000;
  private runtime: AgentRuntime;

  constructor(
    private db: DbClient,
    private logger: Logger = noopLogger,
    private createConnection = createAgentConnection,
    runtime?: AgentRuntime,
  ) {
    if (runtime) {
      this.runtime = runtime;
    } else if (createConnection !== createAgentConnection) {
      this.runtime = new LegacyConnectionRuntimeAdapter(createConnection, logger);
    } else {
      this.runtime = new DefaultAgentRuntime(spawn, logger);
    }
  }

  // Probing logic internalized within ProviderRegistry

  private notFoundEntry(agent: RegistryAgent, enabled = false): ProviderDiscovery {
    return {
      id: agent.id,
      label: agent.name,
      status: 'not_found',
      command: agent.id,
      enabled,
      launchArgs: [],
      launchEnv: {},
      customEnv: {},
      authMethods: [],
      version: agent.version,
      description: agent.description,
      icon: agent.icon,
      supportsDynamicModel: false,
      supportsDynamicConfig: false,
    };
  }

  async probeAgent(
    agent: RegistryAgent,
    launch: { command: string; args: string[]; env: Record<string, string> },
    _options: { timeoutMs?: number } = {},
  ): Promise<ProviderDiscovery> {
    try {
      const probeResult = await this.runtime.probe(launch.command, launch.args, launch.env);
      return {
        id: agent.id,
        label: agent.name,
        status: probeResult.status,
        command: launch.command,
        enabled: false,
        launchArgs: launch.args,
        launchEnv: launch.env,
        customEnv: {},
        configOptions: probeResult.configOptions,
        authMethods: probeResult.authMethods,
        version: agent.version,
        description: agent.description,
        icon: agent.icon,
        supportsDynamicModel: probeResult.supportsDynamicModel,
        supportsDynamicConfig: probeResult.supportsDynamicConfig,
      };
    } catch (err) {
      this.logger.error(err, `Probe failed for ${agent.id}`);
      return this.notFoundEntry(agent);
    }
  }

  async discover(): Promise<ProviderDiscovery[]> {
    const rows = await this.db.select().from(providers);

    let activeRows = rows;

    if (rows.length === 0) {
      this.logger.info('Registry is empty, performing initial sync...');
      await this.sync();

      activeRows = await this.db.select().from(providers);
      if (activeRows.length === 0) {
        this.logger.warn('Provider registry sync completed without any discoverable providers');
        return [];
      }
    }

    // Trigger background probing for any inactive but enabled providers
    for (const row of activeRows) {
      if (row.status === 'inactive' && row.enabled) {
        this.logger.info(`Triggering background probe for enabled provider: ${row.id}`);
        void this.ensureProviderReady(row.id).catch((err: unknown) => {
          this.logger.error(err, `Background probe failed for ${row.id}`);
        });
      }
    }

    return activeRows.map((row) => new Provider(row).toDiscovery());
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
        throw new Error(
          `Failed to fetch registry: ${String(response.status)} ${response.statusText}`,
        );
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
    const preferredIds = [
      settings.defaultProviderId,
      ...existingRows.filter((row) => row.enabled).map((row) => row.id),
    ].filter((id): id is string => id !== undefined && id !== '');

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

    const existingProbe = this.probesInFlight.get(providerId);
    if (existingProbe && !force) {
      return existingProbe;
    }

    const probePromise = (async () => {
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

      const probeResult = await this.probeAgent(agentStub, launch);
      probeResult.enabled = row.enabled;
      probeResult.customEnv = parseJSON(row.customEnv, {});
      await this.persistProvider(probeResult);

      const updatedRow = await this.getProviderRow(providerId);
      if (!updatedRow) {
        throw new Error(`Provider ${providerId} vanished after probe`);
      }
      return new Provider(updatedRow);
    })();

    this.probesInFlight.set(providerId, probePromise);

    try {
      return await probePromise;
    } finally {
      this.probesInFlight.delete(providerId);
    }
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

    const allowedAgentsStr = process.env.ALLOWED_AGENTS ?? process.env.AGENTCTL_ALLOWED_AGENTS;
    if (!allowedAgentsStr) {
      throw new Error('ALLOWED_AGENTS environment variable is required');
    }
    
    const allowedSet = new Set(
      allowedAgentsStr
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
    const filteredAgents = registryAgents.filter((agent) => allowedSet.has(agent.id));

    const existingRows = await this.db.select().from(providers);
    const warmProviderId = await this.pickWarmProviderId(existingRows, filteredAgents);
    const supportedIds = new Set(filteredAgents.map((agent) => agent.id));
    const existingMap = new Map(existingRows.map((row) => [row.id, row]));

    for (const agent of filteredAgents) {
      const existing = existingMap.get(agent.id);
      const launch = resolveLaunchConfig(agent);
      const discovery = buildSyncedDiscovery(agent, launch, existing);

      await this.persistProvider(discovery);

      if (warmProviderId === agent.id && discovery.status !== 'not_found') {
        this.logger.info(`Hydrating selected provider asynchronously: ${agent.id}`);
        void this.ensureProviderReady(agent.id).catch((err: unknown) => {
          this.logger.error(err, `Failed to hydrate provider ${agent.id}`);
        });
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

    this.logger.info(`Sync complete. Persisted ${String(filteredAgents.length)} providers.`);
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

    const { child, connection } = this.createConnection(discovery.command, discovery.launchArgs, {
      ...discovery.launchEnv,
      ...discovery.customEnv,
    });

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

  async setProviderConfig(
    providerId: string,
    customEnv: Record<string, string>,
  ): Promise<ProviderDiscovery> {
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
          (p) => p.status === 'inactive' && (p.enabled || p.id === settings.defaultProviderId),
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
