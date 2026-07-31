import os from 'node:os';
import { spawn } from 'node:child_process';
import {
  registrySchema,
  type ProviderDiscovery,
  type RegistryAgent,
  type ACPConfigOption,
} from '@agentctl/shared';
import { type Logger, noopLogger } from '../logger.js';
import type { AgentRuntime } from '../acp/types.js';
import { createAgentConnection, DefaultAgentRuntime, isAuthRequiredError } from '../acp/index.js';
import type { DbClient } from '../acp/session-client.js';
import { Provider, type ProviderData } from './provider.js';
import { ProviderStore } from './registry/provider-store.js';
import { BinaryInstaller } from './registry/binary-installer.js';
import { RegistryFetcher } from './registry/registry-fetcher.js';
import { ProviderLauncher, resolveNpxPackageSpec } from './registry/provider-launcher.js';
import { AuthProvider } from './registry/auth-provider.js';
import { ProviderSync } from './registry/provider-sync.js';
import { PersistentAgentConnectionManager } from './registry/persistent-connection.js';

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

export function parseRegistryAgents(data: string): RegistryAgent[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch (cause) {
    throw new Error('Registry snapshot contains invalid JSON. Run a registry sync and try again.', {
      cause,
    });
  }

  const validated = registrySchema.safeParse(parsed);
  if (!validated.success) {
    throw new Error(
      `Registry snapshot failed validation. Run a registry sync and try again: ${validated.error.message}`,
    );
  }

  return validated.data.agents;
}

interface ProviderOperation {
  name: string;
  promise: Promise<unknown>;
}

interface CoordinationWaiter {
  kind: 'mutation' | 'sync';
  resolve: (release: () => void) => void;
}

export class ProviderRegistry {
  private fetcher: RegistryFetcher;
  private installer: BinaryInstaller;
  private store: ProviderStore;
  private launcher: ProviderLauncher;
  private authProvider: AuthProvider;
  private syncProvider: ProviderSync;
  private runtime: AgentRuntime;

  private providerOperations = new Map<string, ProviderOperation>();
  private activeMutations = 0;
  private syncActive = false;
  private coordinationWaiters: CoordinationWaiter[] = [];
  private activeSync?: Promise<void>;
  private connectionManager: PersistentAgentConnectionManager;

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
    this.connectionManager = new PersistentAgentConnectionManager(
      this.store,
      this.fetcher,
      this.launcher,
      logger,
    );
    this.launcher.setConnectionManager(this.connectionManager);
    this.authProvider = new AuthProvider(this.launcher, this.store, this.connectionManager);
    this.syncProvider = new ProviderSync(this.fetcher, this.store, this.installer, this.launcher);
  }

  getConnectionManager(): PersistentAgentConnectionManager {
    return this.connectionManager;
  }

  private acquireMutation(): Promise<() => void> {
    if (!this.syncActive && this.coordinationWaiters.length === 0) {
      this.activeMutations += 1;
      return Promise.resolve(() => {
        this.releaseMutation();
      });
    }

    return new Promise((resolve) => {
      this.coordinationWaiters.push({ kind: 'mutation', resolve });
      this.processCoordinationWaiters();
    });
  }

  private acquireSync(): Promise<() => void> {
    if (!this.syncActive && this.activeMutations === 0 && this.coordinationWaiters.length === 0) {
      this.syncActive = true;
      return Promise.resolve(() => {
        this.releaseSync();
      });
    }

    return new Promise((resolve) => {
      this.coordinationWaiters.push({ kind: 'sync', resolve });
      this.processCoordinationWaiters();
    });
  }

  private releaseMutation(): void {
    this.activeMutations -= 1;
    this.processCoordinationWaiters();
  }

  private releaseSync(): void {
    this.syncActive = false;
    this.processCoordinationWaiters();
  }

  private processCoordinationWaiters(): void {
    if (this.syncActive || this.activeMutations > 0 || this.coordinationWaiters.length === 0) {
      return;
    }

    if (this.coordinationWaiters[0].kind === 'sync') {
      const waiter = this.coordinationWaiters.shift();
      if (!waiter) return;
      this.syncActive = true;
      waiter.resolve(() => {
        this.releaseSync();
      });
      return;
    }

    while (this.coordinationWaiters.length > 0) {
      const waiter: CoordinationWaiter = this.coordinationWaiters[0];
      if (waiter.kind !== 'mutation') break;
      this.coordinationWaiters.shift();
      this.activeMutations += 1;
      waiter.resolve(() => {
        this.releaseMutation();
      });
    }
  }

  private async runMutation<T>(op: () => Promise<T>): Promise<T> {
    const release = await this.acquireMutation();
    try {
      return await op();
    } finally {
      release();
    }
  }

  private async runSync(op: () => Promise<void>): Promise<void> {
    const release = await this.acquireSync();
    try {
      await op();
    } finally {
      release();
    }
  }

  private runProviderOperation<T>(
    providerId: string,
    operationName: string,
    op: () => Promise<T>,
  ): Promise<T> {
    const previous = this.providerOperations.get(providerId);
    if (previous?.name === operationName) {
      return previous.promise as Promise<T>;
    }

    const promise = this.runMutation(async () => {
      await previous?.promise.catch(() => undefined);
      return op();
    });
    this.providerOperations.set(providerId, { name: operationName, promise });

    void promise.then(
      () => {
        this.clearProviderOperation(providerId, promise);
      },
      () => {
        this.clearProviderOperation(providerId, promise);
      },
    );
    return promise;
  }

  private clearProviderOperation(providerId: string, promise: Promise<unknown>): void {
    if (this.providerOperations.get(providerId)?.promise === promise) {
      this.providerOperations.delete(providerId);
    }
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
          distribution: JSON.stringify(agent.distribution),
          launchArgs: '[]',
          launchEnv: '{}',
          configOptions: JSON.stringify(agent.configOptions ?? []),
          authMethods: JSON.stringify(agent.authMethods ?? []),
          version: agent.version,
          description: agent.description,
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
    return this.runProviderOperation(providerId, 'install', () => this.doInstall(providerId));
  }

  private async doInstall(providerId: string): Promise<ProviderDiscovery> {
    const snapshot = this.fetcher.getSnapshot();
    if (!snapshot) {
      throw new Error('No registry snapshot found. Please sync first.');
    }

    const agents = parseRegistryAgents(snapshot.data);
    const agent = agents.find((a) => a.id === providerId);
    if (!agent) {
      throw new Error(`Agent ${providerId} not found in registry`);
    }

    const platform = getPlatformKey();
    const binary = agent.distribution.binary;
    const platformTarget = binary ? binary[platform] : undefined;

    let installState: 'not_installed' | 'installed_local' | 'system_available';
    let command: string;
    let launchArgs: string[];
    let launchEnv: Record<string, string>;

    if (platformTarget) {
      const result = await this.installer.install(agent, platform, this.logger);
      installState = 'installed_local';
      command = result.command;
      launchArgs = result.args;
      launchEnv = result.env;
    } else if (agent.distribution.npx) {
      const onPath = await this.launcher.isBinaryOnPath('npx');
      if (!onPath) throw new Error('npx not found on PATH. Install Node.js/npm first.');
      installState = 'system_available';
      command = 'npx';
      launchArgs = [
        '-y',
        resolveNpxPackageSpec(agent.distribution.npx.package, agent.version),
        ...(agent.distribution.npx.args ?? []),
      ];
      launchEnv = agent.distribution.npx.env;
    } else if (agent.distribution.uvx) {
      const onPath = await this.launcher.isBinaryOnPath('uvx');
      if (!onPath) throw new Error('uvx not found on PATH. Install uv first.');
      installState = 'system_available';
      command = 'uvx';
      launchArgs = [agent.distribution.uvx.package, ...(agent.distribution.uvx.args ?? [])];
      launchEnv = agent.distribution.uvx.env;
    } else if (binary) {
      throw new Error(`Agent ${providerId} binary not available for platform ${platform}`);
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
      authState: (agent.authMethods ?? []).length ? 'unknown' : 'authenticated',
      supportsDynamicModel: agent.supportsDynamicModel ?? false,
      supportsDynamicConfig: agent.supportsDynamicConfig ?? false,
      supportsLogout: agent.supportsLogout ?? false,
    });

    // Run probe to populate config options (model list, currentValue, etc.)
    this.launcher.invalidateProbe(providerId);
    await this.launcher.probe(providerId, this.runtime, agent).catch(() => undefined);

    const row = this.store.get(providerId);
    if (!row) throw new Error(`Provider ${providerId} vanished`);
    return new Provider(row).toDiscovery();
  }

  async remove(providerId: string): Promise<ProviderDiscovery> {
    return this.runProviderOperation(providerId, 'remove', () => this.doRemove(providerId));
  }

  private async doRemove(providerId: string): Promise<ProviderDiscovery> {
    const provider = this.store.get(providerId);
    if (!provider) throw new Error(`Provider ${providerId} not found`);

    const snapshot = this.fetcher.getSnapshot();
    const agents = snapshot ? parseRegistryAgents(snapshot.data) : [];
    const agent = agents.find((a) => a.id === providerId);
    const wasDefault = this.store.getDefaultProviderId() === providerId;

    this.launcher.invalidateProbe(providerId);

    if (provider.installState === 'installed_local') {
      await this.installer.remove(providerId, this.logger);
    }

    this.store.delete(providerId);

    if (wasDefault) {
      const nextDefault = this.store
        .list()
        .find((candidate) => candidate.enabled && candidate.installState !== 'not_installed');
      this.setDefaultProvider(nextDefault?.id ?? null);
    }

    const synthetic: ProviderData = agent
      ? {
          id: agent.id,
          name: agent.name,
          command: agent.distribution.npx ? 'npx' : agent.distribution.uvx ? 'uvx' : agent.id,
          installState: 'not_installed',
          authState: 'unknown',
          enabled: true,
          hidden: false,
          distribution: JSON.stringify(agent.distribution),
          launchArgs: '[]',
          launchEnv: '{}',
          configOptions: JSON.stringify(agent.configOptions ?? []),
          authMethods: JSON.stringify(agent.authMethods ?? []),
          version: agent.version,
          description: agent.description,
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
    return this.runProviderOperation(providerId, `login:${methodId}`, async () => {
      const snapshot = this.fetcher.getSnapshot();
      const agents = snapshot ? parseRegistryAgents(snapshot.data) : [];
      const agent = agents.find((a) => a.id === providerId);

      await this.authProvider.login(providerId, agent, methodId, params, createAgentConnection);
    });
  }

  async logout(providerId: string): Promise<void> {
    return this.runProviderOperation(providerId, 'logout', async () => {
      const snapshot = this.fetcher.getSnapshot();
      const agents = snapshot ? parseRegistryAgents(snapshot.data) : [];
      const agent = agents.find((a) => a.id === providerId);

      await this.authProvider.logout(providerId, agent, createAgentConnection);
    });
  }

  async activate(providerId: string): Promise<ProviderDiscovery> {
    return this.runProviderOperation(providerId, 'activate', async () => {
      const row = this.store.get(providerId);
      if (!row) throw new Error(`Provider ${providerId} not found`);

      if (row.authState === 'unknown' && row.installState !== 'not_installed') {
        const snapshot = this.fetcher.getSnapshot();
        const agents = snapshot ? parseRegistryAgents(snapshot.data) : [];
        const agent = agents.find((a) => a.id === providerId);
        if (agent) {
          await this.probeWithStatePreserved(providerId, agent, row.authState, 'activate');
        }
      }

      const updated = this.store.get(providerId);
      if (!updated) throw new Error(`Provider ${providerId} vanished`);
      return new Provider(updated).toDiscovery();
    });
  }

  async refreshProvider(providerId: string): Promise<ProviderDiscovery> {
    return this.runProviderOperation(providerId, 'refresh', async () => {
      const rowBeforeProbe = this.store.get(providerId);
      if (!rowBeforeProbe) throw new Error(`Provider ${providerId} not found`);

      const snapshot = this.fetcher.getSnapshot();
      const agents = snapshot ? parseRegistryAgents(snapshot.data) : [];
      const agent = agents.find((a) => a.id === providerId);

      this.launcher.invalidateProbe(providerId);
      if (agent) {
        await this.probeWithStatePreserved(providerId, agent, rowBeforeProbe.authState, 'refresh');
      }

      const row = this.store.get(providerId);
      if (!row) throw new Error(`Provider ${providerId} vanished`);
      return new Provider(row).toDiscovery();
    });
  }

  async probeAllInstalledProviders(): Promise<void> {
    const allProviders = this.store.list();
    const candidates = allProviders.filter(
      (row) => row.installState !== 'not_installed' && row.authState !== 'needs_auth',
    );

    const snapshot = this.fetcher.getSnapshot();
    const agents = snapshot ? parseRegistryAgents(snapshot.data) : [];

    await Promise.allSettled(
      candidates.map(async (row) => {
        try {
          const agent = agents.find((a) => a.id === row.id);
          if (agent) {
            await this.probeWithStatePreserved(row.id, agent, row.authState, 'startup-probe');
          } else {
            await this.refreshProvider(row.id);
          }
        } catch (err) {
          this.logger.warn(
            { err, providerId: row.id },
            'Background startup probe failed for provider',
          );
        }
      }),
    );
  }

  async setProviderConfig(
    providerId: string,
    updates: {
      customEnv?: Record<string, string>;
      nativelyLoadsSkills?: boolean;
      defaultConfigOptions?: ACPConfigOption[];
    },
  ): Promise<ProviderDiscovery> {
    return this.runProviderOperation(providerId, 'set-config', async () => {
      const rowBeforeUpdate = this.store.get(providerId);
      if (!rowBeforeUpdate) throw new Error(`Provider ${providerId} not found`);

      if (updates.customEnv !== undefined) {
        let existingCustomEnv: Record<string, string> = {};
        try {
          existingCustomEnv = JSON.parse(rowBeforeUpdate.customEnv || '{}') as Record<
            string,
            string
          >;
        } catch {
          existingCustomEnv = {};
        }

        const merged: Record<string, string> = {};
        const removeKeys = new Set(
          Object.entries(updates.customEnv)
            .filter(([, value]) => value.trim().length === 0)
            .map(([key]) => key),
        );
        for (const [key, value] of Object.entries(existingCustomEnv)) {
          if (!removeKeys.has(key)) merged[key] = value;
        }
        for (const [key, value] of Object.entries(updates.customEnv)) {
          if (value.trim().length > 0) merged[key] = value;
        }
        this.store.setCustomEnv(providerId, merged);
      }
      if (updates.nativelyLoadsSkills !== undefined) {
        this.store.update(providerId, { nativelyLoadsSkills: updates.nativelyLoadsSkills });
      }
      if (updates.defaultConfigOptions !== undefined) {
        this.store.setDefaultConfigOptions(providerId, updates.defaultConfigOptions);
      }

      this.launcher.invalidateProbe(providerId);

      const snapshot = this.fetcher.getSnapshot();
      const agents = snapshot ? parseRegistryAgents(snapshot.data) : [];
      const agent = agents.find((a) => a.id === providerId);
      if (agent) {
        await this.probeWithStatePreserved(
          providerId,
          agent,
          rowBeforeUpdate.authState,
          'apply configuration for',
        );
      }

      const row = this.store.get(providerId);
      if (!row) throw new Error(`Provider ${providerId} vanished`);
      return new Provider(row).toDiscovery();
    });
  }

  private async probeWithStatePreserved(
    providerId: string,
    agent: RegistryAgent,
    previousAuthState: ProviderData['authState'],
    action: string,
  ): Promise<void> {
    try {
      await this.launcher.probe(providerId, this.runtime, agent);
    } catch (cause) {
      if (isAuthRequiredError(cause)) {
        if (previousAuthState !== 'authenticated') {
          this.store.setAuthState(providerId, 'needs_auth');
        }
        return;
      }
      if (this.store.get(providerId)) {
        const restoredAuthState =
          previousAuthState === 'authenticated' ||
          previousAuthState === 'error' ||
          previousAuthState === 'needs_auth' ||
          previousAuthState === 'unknown'
            ? previousAuthState
            : 'unknown';
        this.store.setAuthState(providerId, restoredAuthState);
      }
      const detail = cause instanceof Error ? cause.message : String(cause);
      throw new Error(`Failed to ${action} provider ${providerId}: ${detail}`, { cause });
    }
  }

  async sync(): Promise<void> {
    if (this.activeSync) return this.activeSync;

    const promise = this.runSync(() => this.syncProvider.sync());
    this.activeSync = promise;
    void promise.then(
      () => {
        if (this.activeSync === promise) this.activeSync = undefined;
      },
      () => {
        if (this.activeSync === promise) this.activeSync = undefined;
      },
    );
    return promise;
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

    if (row.installState === 'installed_local' && !this.installer.isInstalled(providerId)) {
      this.store.setInstallState(providerId, 'not_installed');
      this.store.setAuthState(providerId, 'unknown');
      row = this.store.get(providerId) ?? row;
    }

    if (row.installState === 'not_installed') {
      await this.install(providerId);
      const updated = this.store.get(providerId);
      if (!updated) throw new Error(`Provider ${providerId} vanished after install`);
      return new Provider(updated);
    }

    if (!options.force && row.authState === 'needs_auth') {
      return new Provider(row);
    }

    if (!options.force && row.authState === 'authenticated') {
      let hasModelConfig = false;
      try {
        const opts = (row.configOptions ? JSON.parse(row.configOptions) : []) as unknown[];
        hasModelConfig = opts.some(
          (opt) =>
            typeof opt === 'object' &&
            opt !== null &&
            'id' in opt &&
            ((opt as Record<string, unknown>).id === 'model' ||
              (opt as Record<string, unknown>).id === 'selectedModel'),
        );
      } catch {
        hasModelConfig = false;
      }
      if (hasModelConfig) {
        return new Provider(row);
      }
    }

    const snapshot = this.fetcher.getSnapshot();
    const agents = snapshot ? parseRegistryAgents(snapshot.data) : [];
    const agent = agents.find((a) => a.id === providerId);

    if (agent) {
      this.launcher.invalidateProbe(providerId);
      try {
        await this.launcher.probe(providerId, this.runtime, agent);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const isAuthError =
          msg.toLowerCase().includes('auth') || msg.toLowerCase().includes('unauthorized');
        if (isAuthError) {
          this.logger.info(
            { providerId },
            'Probe failed due to auth error, setting state to needs_auth',
          );
          this.store.setAuthState(providerId, 'needs_auth');
          const rowNow = this.store.get(providerId);
          if (rowNow) return new Provider(rowNow);
        }
        this.logger.error({ err, providerId }, 'Probe failed, setting auth state to error');
        this.store.setAuthState(providerId, 'error');
        throw err;
      }
    }

    const updated = this.store.get(providerId);
    if (!updated) throw new Error(`Provider ${providerId} vanished after probe`);
    return new Provider(updated);
  }

  getProvider(id: string): Provider | undefined {
    const row = this.store.get(id);
    return row ? new Provider(row) : undefined;
  }

  getSettings(): Record<string, string | undefined> {
    const keys = [
      'onboardingCompleted',
      'onboardingVersion',
      'setupStep',
      'defaultProviderId',
      'showThinking',
      'registrySyncError',
      'fontConfig',
    ];
    const settings: Record<string, string | undefined> = {};
    for (const key of keys) {
      const val = this.store.getSetting(key);
      if (val !== undefined) settings[key] = val;
    }
    return settings;
  }

  updateSetting(key: string, value: string): void {
    this.store.updateSetting(key, value);
  }

  setDefaultProvider(id: string | null | undefined): void {
    const normalized = id?.trim() ? id.trim() : null;
    if (normalized) {
      const exists = this.store
        .list()
        .some((p) => p.id === normalized && p.enabled && p.installState !== 'not_installed');
      if (!exists) {
        throw new Error(
          `Cannot set default provider: ${normalized} is not an enabled, installed provider`,
        );
      }
    }
    if (normalized) {
      this.store.setDefaultProviderId(normalized);
    } else {
      this.store.deleteSetting('defaultProviderId');
    }
  }

  probeAgent(
    agent: RegistryAgent,
    launch: { command: string; args: string[]; env: Record<string, string> },
    _options?: object,
    _existing?: ProviderData,
  ): ProviderDiscovery {
    const dummyStore: ProviderData = {
      id: agent.id,
      name: agent.name,
      installState: 'system_available',
      authState: 'unknown',
      enabled: true,
      hidden: false,
      distribution: '{}',
      command: launch.command,
      launchArgs: JSON.stringify(launch.args),
      launchEnv: JSON.stringify(launch.env),
      configOptions: '[]',
      authMethods: '[]',
      version: agent.version,
      description: agent.description,
      icon: agent.icon ?? null,
      customEnv: '{}',
      supportsDynamicModel: agent.supportsDynamicModel ?? false,
      supportsDynamicConfig: agent.supportsDynamicConfig ?? false,
      supportsLogout: agent.supportsLogout ?? false,
      nativelyLoadsSkills: false,
      modes: '[]',
      createdAt: new Date(),
      updatedAt: new Date(),
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
      customEnvConfigured: {},
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
