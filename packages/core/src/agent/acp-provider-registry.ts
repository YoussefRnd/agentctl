import os from 'node:os';
import { spawn } from 'node:child_process';
import type {
  ProviderDiscovery,
  RegistryAgent,
} from '@agentctl/shared';
import { type Logger, noopLogger } from '../logger.js';
import type { AgentRuntime } from './acp-transport.js';
import { createAgentConnection, DefaultAgentRuntime } from './acp-transport.js';
import type { DbClient } from './acp-session.js';
import { Provider, type ProviderData } from './provider.js';
import { ProviderStore } from './registry/provider-store.js';
import { BinaryInstaller } from './registry/binary-installer.js';
import { RegistryFetcher } from './registry/registry-fetcher.js';
import { ProviderLauncher } from './registry/provider-launcher.js';
import { AuthProvider } from './registry/auth-provider.js';
import { ProviderSync } from './registry/provider-sync.js';

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
  return `${platformMap[platform] ?? platform}-${archMap[arch] ?? arch}`;
}

function parseRegistryAgents(data: string): RegistryAgent[] {
  const parsed = JSON.parse(data) as { agents: RegistryAgent[] };
  return parsed.agents;
}

export class ProviderRegistry {
  private fetcher: RegistryFetcher;
  private installer: BinaryInstaller;
  private store: ProviderStore;
  private launcher: ProviderLauncher;
  private authProvider: AuthProvider;
  private syncProvider: ProviderSync;
  private runtime: AgentRuntime;

  constructor(
    private db: DbClient,
    private logger: Logger = noopLogger,
    runtime?: AgentRuntime,
  ) {
    this.runtime = runtime ?? new DefaultAgentRuntime(spawn, logger);
    this.fetcher = new RegistryFetcher(db, logger);
    this.installer = new BinaryInstaller();
    this.store = new ProviderStore(db);
    this.launcher = new ProviderLauncher(this.store, this.installer);
    this.authProvider = new AuthProvider(this.launcher, this.store);
    this.syncProvider = new ProviderSync(this.fetcher, this.store, this.installer, this.launcher);
  }

  getInstallDir(providerId: string): string {
    return this.installer.getInstallDir(providerId);
  }

  async discover(): Promise<ProviderDiscovery[]> {
    const rows = this.store.list();

    if (rows.length === 0) {
      this.logger.info('Registry is empty, performing initial sync...');
      await this.sync();
      const afterSync = this.store.list();
      if (afterSync.length === 0) {
        this.logger.warn('Provider registry sync completed without any discoverable providers');
        return [];
      }
      return afterSync.map((row) => new Provider(row).toDiscovery());
    }

    for (const row of rows) {
      if (row.authState === 'unknown' && row.installState !== 'not_installed') {
        this.logger.info(`Triggering background probe for enabled provider: ${row.id}`);
        const snapshot = await this.fetcher.getSnapshot();
        const agents = snapshot ? parseRegistryAgents(snapshot.data) : [];
        const agent = agents.find((a) => a.id === row.id);
        if (agent) {
          void this.launcher.probe(row.id, this.runtime, agent).catch((err: unknown) => {
            this.logger.error(err, `Background probe failed for ${row.id}`);
          });
        }
      }
    }

    return rows.map((row) => new Provider(row).toDiscovery());
  }

  async catalog(): Promise<ProviderDiscovery[]> {
    const agents = await this.fetcher.fetch();
    return agents.map((agent) => {
      const row = this.store.get(agent.id);
      let discovery: ProviderDiscovery;
      if (row) {
        discovery = new Provider(row).toDiscovery();
      } else {
        const dist = agent.distribution;
        const command = dist.npx ? 'npx' : dist.uvx ? 'uvx' : agent.id;
        const synthetic: ProviderData = {
          id: agent.id,
          name: agent.name,
          command,
          installState: 'not_installed',
          authState: 'unknown',
          enabled: true,
          hidden: false,
          distribution: JSON.stringify(agent.distribution ?? {}),
          launchArgs: '[]',
          launchEnv: '{}',
          configOptions: JSON.stringify(agent.configOptions ?? []),
          authMethods: JSON.stringify(agent.authMethods ?? []),
          version: agent.version,
          description: agent.description ?? null,
          icon: agent.icon ?? null,
          customEnv: '{}',
          supportsDynamicModel: !!agent.supportsDynamicModel,
          supportsDynamicConfig: !!agent.supportsDynamicConfig,
          supportsLogout: !!agent.supportsLogout,
          nativelyLoadsSkills: false,
          modes: '[]',
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        discovery = new Provider(synthetic).toDiscovery();
      }

      if (discovery.agent) {
        discovery.agent = {
          ...discovery.agent,
          repository: agent.repository,
          website: agent.website,
        };
      }

      return discovery;
    });
  }

  async install(providerId: string): Promise<ProviderDiscovery> {
    const snapshot = await this.fetcher.getSnapshot();
    if (!snapshot) {
      throw new Error('No registry snapshot found. Please sync first.');
    }

    const agents = parseRegistryAgents(snapshot.data);
    const agent = agents.find((a) => a.id === providerId);
    if (!agent) {
      throw new Error(`Agent ${providerId} not found in registry`);
    }

    let installState: 'not_installed' | 'installed_local' | 'system_available';
    let command: string;
    let launchArgs: string[];
    let launchEnv: Record<string, string>;

    if (agent.distribution.binary) {
      const platform = getPlatformKey();
      const result = await this.installer.install(agent, platform);
      installState = 'installed_local';
      command = result.command;
      launchArgs = result.args;
      launchEnv = result.env;
    } else if (agent.distribution.npx) {
      const onPath = await this.launcher.isBinaryOnPath('npx');
      if (!onPath) throw new Error('npx not found on PATH. Install Node.js/npm first.');
      installState = 'system_available';
      command = 'npx';
      launchArgs = ['-y', agent.distribution.npx.package, ...(agent.distribution.npx.args ?? [])];
      launchEnv = agent.distribution.npx.env ?? {};
    } else if (agent.distribution.uvx) {
      const onPath = await this.launcher.isBinaryOnPath('uvx');
      if (!onPath) throw new Error('uvx not found on PATH. Install uv first.');
      installState = 'system_available';
      command = 'uvx';
      launchArgs = [agent.distribution.uvx.package, ...(agent.distribution.uvx.args ?? [])];
      launchEnv = agent.distribution.uvx.env ?? {};
    } else {
      throw new Error(`Agent ${providerId} does not support installation`);
    }

    this.store.upsert(providerId, {
      name: agent.name,
      version: agent.version,
      description: agent.description,
      icon: agent.icon,
      command,
      launchArgs: JSON.stringify(launchArgs),
      launchEnv: JSON.stringify(launchEnv),
      customEnv: '{}',
      configOptions: JSON.stringify(agent.configOptions ?? []),
      authMethods: JSON.stringify(agent.authMethods ?? []),
      installState,
      authState: 'unknown',
      supportsDynamicModel: agent.supportsDynamicModel ?? false,
      supportsDynamicConfig: agent.supportsDynamicConfig ?? false,
      supportsLogout: agent.supportsLogout ?? false,
    });

    void this.launcher.probe(providerId, this.runtime, agent).catch((err: unknown) => {
      this.logger.error(err, `Install probe failed for ${providerId}`);
    });

    const row = this.store.get(providerId);
    return new Provider(row!).toDiscovery();
  }

  async remove(providerId: string): Promise<ProviderDiscovery> {
    const provider = this.store.get(providerId);
    if (!provider) throw new Error(`Provider ${providerId} not found`);

    this.launcher.invalidateProbe(providerId);

    if (provider.installState === 'installed_local') {
      await this.installer.remove(providerId);
    }

    this.store.delete(providerId);

    const snapshot = await this.fetcher.getSnapshot();
    const agents = snapshot ? parseRegistryAgents(snapshot.data) : [];
    const agent = agents.find((a) => a.id === providerId);

    const synthetic: ProviderData = agent
      ? {
          id: agent.id,
          name: agent.name,
          command: agent.distribution.npx ? 'npx' : (agent.distribution.uvx ? 'uvx' : agent.id),
          installState: 'not_installed',
          authState: 'unknown',
          enabled: true,
          hidden: false,
          distribution: JSON.stringify(agent.distribution ?? {}),
          launchArgs: '[]',
          launchEnv: '{}',
          configOptions: JSON.stringify(agent.configOptions ?? []),
          authMethods: JSON.stringify(agent.authMethods ?? []),
          version: agent.version,
          description: agent.description ?? null,
          icon: agent.icon ?? null,
          customEnv: '{}',
          supportsDynamicModel: !!agent.supportsDynamicModel,
          supportsDynamicConfig: !!agent.supportsDynamicConfig,
          supportsLogout: !!agent.supportsLogout,
          nativelyLoadsSkills: false,
          modes: '[]',
          createdAt: new Date(),
          updatedAt: new Date(),
        }
      : {
          id: providerId,
          name: provider.name,
          command: providerId,
          installState: 'not_installed',
          authState: 'unknown',
          enabled: true,
          hidden: false,
          distribution: '{}',
          launchArgs: '[]',
          launchEnv: '{}',
          configOptions: '[]',
          authMethods: '[]',
          version: provider.version,
           description: provider.description,
           icon: provider.icon,
           customEnv: '{}',
          supportsDynamicModel: false,
          supportsDynamicConfig: false,
          supportsLogout: false,
          nativelyLoadsSkills: false,
          modes: '[]',
          createdAt: new Date(),
          updatedAt: new Date(),
        };

    return new Provider(synthetic).toDiscovery();
  }

  async login(
    providerId: string,
    methodId: string,
    params: Record<string, unknown> = {},
  ): Promise<void> {
    const snapshot = await this.fetcher.getSnapshot();
    const agents = snapshot ? parseRegistryAgents(snapshot.data) : [];
    const agent = agents.find((a) => a.id === providerId);

    await this.authProvider.login(providerId, agent ?? { id: providerId }, methodId, params, createAgentConnection);
  }

  async logout(providerId: string): Promise<void> {
    const snapshot = await this.fetcher.getSnapshot();
    const agents = snapshot ? parseRegistryAgents(snapshot.data) : [];
    const agent = agents.find((a) => a.id === providerId);

    await this.authProvider.logout(providerId, agent ?? { id: providerId }, createAgentConnection);
  }

  async activate(providerId: string): Promise<ProviderDiscovery> {
    const row = this.store.get(providerId);
    if (!row) throw new Error(`Provider ${providerId} not found`);

    if (row.authState === 'unknown' && row.installState !== 'not_installed') {
      const snapshot = await this.fetcher.getSnapshot();
      const agents = snapshot ? parseRegistryAgents(snapshot.data) : [];
      const agent = agents.find((a) => a.id === providerId);
      if (agent) {
        await this.launcher.probe(providerId, this.runtime, agent).catch(() => {});
      }
    }

    const updated = this.store.get(providerId);
    return new Provider(updated!).toDiscovery();
  }

  async refreshProvider(providerId: string): Promise<ProviderDiscovery> {
    const snapshot = await this.fetcher.getSnapshot();
    const agents = snapshot ? parseRegistryAgents(snapshot.data) : [];
    const agent = agents.find((a) => a.id === providerId);

    this.launcher.invalidateProbe(providerId);
    if (agent) {
      await this.launcher.probe(providerId, this.runtime, agent).catch(() => {});
    }

    const row = this.store.get(providerId);
    if (!row) throw new Error(`Provider ${providerId} vanished`);
    return new Provider(row).toDiscovery();
  }

  async setProviderConfig(
    providerId: string,
    updates: {
      customEnv?: Record<string, string>;
      nativelyLoadsSkills?: boolean;
    },
  ): Promise<ProviderDiscovery> {
    if (updates.customEnv !== undefined) {
      this.store.setCustomEnv(providerId, updates.customEnv);
    }
    if (updates.nativelyLoadsSkills !== undefined) {
      this.store.update(providerId, { nativelyLoadsSkills: updates.nativelyLoadsSkills });
    }

    this.launcher.invalidateProbe(providerId);

    const snapshot = await this.fetcher.getSnapshot();
    const agents = snapshot ? parseRegistryAgents(snapshot.data) : [];
    const agent = agents.find((a) => a.id === providerId);
    if (agent) {
      await this.launcher.probe(providerId, this.runtime, agent).catch(() => {});
    }

    const row = this.store.get(providerId);
    return new Provider(row!).toDiscovery();
  }

  async sync(options?: { force?: boolean }): Promise<void> {
    if (this.syncProvider) {
      await this.syncProvider.sync();
    }
  }

  async ensureProviderReady(
    providerId: string,
    options: { force?: boolean } = {},
  ): Promise<Provider> {
    let row = this.store.get(providerId);
    if (!row) {
      await this.sync();
      row = this.store.get(providerId);
    }
    if (!row) throw new Error(`Provider ${providerId} not found`);

    if (!options.force && (row.authState === 'authenticated' || row.authState === 'needs_auth')) {
      if (row.installState === 'installed_local') {
        if (!this.installer.isInstalled(providerId)) {
          this.store.setInstallState(providerId, 'not_installed');
          this.store.setAuthState(providerId, 'unknown');
          return new Provider({ ...row, installState: 'not_installed', authState: 'unknown' });
        }
      }
      return new Provider(row);
    }

    const snapshot = await this.fetcher.getSnapshot();
    const agents = snapshot ? parseRegistryAgents(snapshot.data) : [];
    const agent = agents.find((a) => a.id === providerId);

    if (agent) {
      this.launcher.invalidateProbe(providerId);
      await this.launcher.probe(providerId, this.runtime, agent, options).catch(() => {});
    }

    const updated = this.store.get(providerId);
    if (!updated) throw new Error(`Provider ${providerId} vanished after probe`);
    return new Provider(updated);
  }

  async getProvider(id: string): Promise<Provider | undefined> {
    const row = this.store.get(id);
    return row ? new Provider(row) : undefined;
  }

  async getSettings(): Promise<Record<string, string>> {
    const keys = [
      'onboardingCompleted', 'onboardingVersion', 'setupStep',
      'defaultProviderId', 'showThinking', 'registrySyncError', 'fontConfig',
    ];
    const settings: Record<string, string> = {};
    for (const key of keys) {
      const val = this.store.getSetting(key);
      if (val !== undefined) settings[key] = val;
    }
    return settings;
  }

  async updateSetting(key: string, value: string): Promise<void> {
    this.store.updateSetting(key, value);
  }

  async probeAgent(
    agent: RegistryAgent,
    launch: { command: string; args: string[]; env: Record<string, string> },
    _options?: object,
    existing?: ProviderData,
  ): Promise<ProviderDiscovery> {
    const dummyStore = {
      command: launch.command,
      launchArgs: JSON.stringify(launch.args),
      launchEnv: JSON.stringify(launch.env),
      installState: 'system_available' as const,
      authState: 'unknown' as const,
    };
    const launchResolved = this.launcher.resolveLaunch(dummyStore, agent);
    const authMethods = agent.authMethods ?? [];
    return {
      id: agent.id,
      label: agent.name,
      command: launchResolved.command,
      launchArgs: launchResolved.args,
      launchEnv: launchResolved.env,
      customEnv: {},
      configOptions: agent.configOptions ?? [],
      authMethods,
      version: agent.version,
      description: agent.description,
      icon: agent.icon,
      supportsDynamicModel: agent.supportsDynamicModel ?? false,
      supportsDynamicConfig: agent.supportsDynamicConfig ?? false,
      supportsLogout: agent.supportsLogout ?? false,
      nativelyLoadsSkills: false,
      installState: 'system_available',
      authState: authMethods.length > 0 ? 'needs_auth' : 'authenticated',
      enabled: true,
      agent,
    };
  }
}
