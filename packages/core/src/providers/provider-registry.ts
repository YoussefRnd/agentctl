import {
  type ProviderDiscovery,
  type RegistryAgent,
  type AgentConfigOption,
} from '@agentctl/shared';
import { type Logger, noopLogger } from '../logger.js';
import type { AgentDriver } from '../agent/types.js';
import type { AgentRuntimeServices } from '../agent/runtime-services.js';
import type { AgentDiagnosticsRecorder } from '../agent/diagnostics.js';
import {
  createDefaultAgentConnectionManager,
  createDefaultAgentDriver,
  defaultAgentDiagnostics,
} from '../default-agent-driver.js';
import { isAgentAuthenticationRequiredError } from '../agent/errors.js';
import type { DbClient } from '../db/index.js';
import { jsonCodecs } from '../db/json-codecs.js';
import { Provider, type ProviderData } from './provider.js';
import { ProviderStore } from './registry/provider-store.js';
import { BinaryInstaller, getPlatformKey } from './registry/binary-installer.js';
import { RegistryFetcher } from './registry/registry-fetcher.js';
import { ProviderLauncher, resolveNpxPackageSpec } from './registry/provider-launcher.js';
import { AuthProvider } from './registry/auth-provider.js';
import { ProviderSync } from './registry/provider-sync.js';

import { ProviderOperationCoordinator } from './registry/provider-operation-coordinator.js';
import { ProviderProbingService } from './registry/provider-probing-service.js';
import { parseRegistryAgents } from './registry/registry-parser.js';
import type { AgentConnectionManager } from '../acp/types.js';

export { getPlatformKey };
export { parseRegistryAgents } from './registry/registry-parser.js';

export class ProviderRegistry {
  private fetcher: RegistryFetcher;
  private installer: BinaryInstaller;
  private store: ProviderStore;
  private launcher: ProviderLauncher;
  private authProvider: AuthProvider;
  private syncProvider: ProviderSync;
  private runtime: AgentDriver;
  private coordinator: ProviderOperationCoordinator;
  private probing: ProviderProbingService;

  private activeSync?: Promise<void>;
  private connectionManager: AgentConnectionManager;
  private diagnostics: AgentDiagnosticsRecorder;

  constructor(
    private db: DbClient,
    private logger: Logger = noopLogger,
    runtime?: AgentDriver,
    runtimeServices?: AgentRuntimeServices,
  ) {
    this.diagnostics = runtimeServices?.diagnostics ?? defaultAgentDiagnostics;
    this.runtime =
      runtimeServices?.driver ?? runtime ?? createDefaultAgentDriver(logger, this.diagnostics);
    this.fetcher = runtimeServices?.providers.fetcher ?? new RegistryFetcher(db, logger);
    this.installer = runtimeServices?.providers.installer ?? new BinaryInstaller();
    this.store = runtimeServices?.providers.store ?? new ProviderStore(db);
    this.launcher =
      runtimeServices?.providers.launcher ?? new ProviderLauncher(this.store, this.installer);
    this.connectionManager =
      runtimeServices?.connections ??
      createDefaultAgentConnectionManager(
        this.store,
        this.fetcher,
        this.launcher,
        logger,
        this.diagnostics,
      );
    this.authProvider = new AuthProvider(this.launcher, this.store, this.runtime);
    this.syncProvider = new ProviderSync(this.fetcher, this.store, this.installer, this.launcher);
    this.coordinator = new ProviderOperationCoordinator();
    this.probing = new ProviderProbingService(
      this.store,
      this.fetcher,
      this.launcher,
      this.runtime,
      this.logger,
    );
  }

  getConnectionManager(): AgentConnectionManager {
    return this.connectionManager;
  }

  getTransportDiagnostics() {
    return this.diagnostics.snapshot(this.connectionManager.getConnectionDiagnostics());
  }

  private runMutation<T>(op: () => Promise<T>): Promise<T> {
    return this.coordinator.runMutation(op);
  }

  private runSync(op: () => Promise<void>): Promise<void> {
    return this.coordinator.runSync(op);
  }

  private runProviderOperation<T>(
    providerId: string,
    operationName: string,
    op: () => Promise<T>,
  ): Promise<T> {
    return this.coordinator.runProviderOperation(providerId, operationName, op);
  }

  getInstallDir(providerId: string): string {
    return this.installer.getInstallDir(providerId);
  }

  async discover(): Promise<ProviderDiscovery[]> {
    let rows = this.store.list();

    if (rows.length === 0) {
      this.logger.info('Registry is empty, performing initial sync...');
      await this.sync();
      rows = this.store.list();
      if (rows.length === 0) {
        this.logger.warn('Provider registry sync completed without any discoverable providers');
        return [];
      }
    }

    // Auto-probe any installed & ready providers that have empty/missing model options
    const unprobedInstalled = rows.filter((row) => {
      if (row.installState === 'not_installed' || row.authState === 'needs_auth') return false;
      const opts = jsonCodecs.agentConfigOptions(row.configOptions);
      const hasModel = opts.some((o) => o.id === 'model' || o.id === 'selectedModel');
      return !hasModel;
    });

    if (unprobedInstalled.length > 0) {
      const snapshot = this.fetcher.getSnapshot();
      const agents = snapshot ? parseRegistryAgents(snapshot.data) : [];
      for (const row of unprobedInstalled) {
        const agent = agents.find((a) => a.id === row.id);
        if (agent) {
          void this.probeWithStatePreserved(row.id, agent, row.authState, 'discover-probe').catch(
            (err) => {
              this.logger.debug(
                { err, providerId: row.id },
                'Background discover probe skipped/failed',
              );
            },
          );
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
          installError: null,
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

    // Step 1: Mark provider as installing in DB
    this.store.upsert(providerId, {
      name: agent.name,
      version: agent.version,
      description: agent.description,
      icon: agent.icon,
      command: providerId,
      installState: 'installing',
      installError: null,
      authState: (agent.authMethods ?? []).length ? 'unknown' : 'authenticated',
      configOptions: JSON.stringify(agent.configOptions ?? []),
      authMethods: JSON.stringify(agent.authMethods ?? []),
      supportsDynamicModel: agent.supportsDynamicModel ?? false,
      supportsDynamicConfig: agent.supportsDynamicConfig ?? false,
      supportsLogout: agent.supportsLogout ?? false,
    });

    const platform = getPlatformKey();
    const binary = agent.distribution.binary;
    const platformTarget = binary ? binary[platform] : undefined;

    let installState: 'installed_local' | 'system_available';
    let command: string;
    let launchArgs: string[];
    let launchEnv: Record<string, string>;

    try {
      // Step 2: Check if binary / CLI is already available on local system PATH
      const detected = await this.launcher.detectSystemBinary(agent, platform);
      if (detected) {
        this.logger.info(
          { providerId, detectedCommand: detected.command },
          'Detected agent binary on local system PATH',
        );
        installState = 'system_available';
        command = detected.command;
        launchArgs = detected.args ?? [];
        launchEnv = {};
      } else if (platformTarget) {
        const result = await this.installer.install(agent, platform, this.logger);
        installState = 'installed_local';
        command = result.command;
        launchArgs = result.args;
        launchEnv = result.env;
      } else if (agent.distribution.npx) {
        const onPath = await this.launcher.isBinaryOnPath('npx');
        if (!onPath) {
          throw new Error('npx not found on PATH. Install Node.js/npm first.');
        }
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
        if (!onPath) {
          throw new Error('uvx not found on PATH. Install uv first.');
        }
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
        installError: null,
        authState: (agent.authMethods ?? []).length ? 'unknown' : 'authenticated',
        supportsDynamicModel: agent.supportsDynamicModel ?? false,
        supportsDynamicConfig: agent.supportsDynamicConfig ?? false,
        supportsLogout: agent.supportsLogout ?? false,
      });

      // Step 3: Run probe to populate config options (model list, currentValue, etc.)
      this.launcher.invalidateProbe(providerId, this.runtime, agent);
      try {
        await this.launcher.probe(providerId, this.runtime, agent);
      } catch (probeErr) {
        const msg = probeErr instanceof Error ? probeErr.message : String(probeErr);
        this.logger.warn({ probeErr, providerId }, 'Install probe verification failed for agent');
        this.store.setInstallState(providerId, 'failed', `Probe verification failed: ${msg}`);
        throw new Error(`Failed to verify agent installation for ${providerId}: ${msg}`, {
          cause: probeErr,
        });
      }

      const row = this.store.get(providerId);
      if (!row) throw new Error(`Provider ${providerId} vanished`);
      return new Provider(row).toDiscovery();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.store.setInstallState(providerId, 'failed', msg);
      throw err;
    }
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

    this.launcher.invalidateProbe(providerId, this.runtime, agent);

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
          installError: null,
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
          installError: null,
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

      this.connectionManager.closeConnection(providerId);
      await this.authProvider.login(providerId, agent, methodId, params);
    });
  }

  async logout(providerId: string): Promise<void> {
    return this.runProviderOperation(providerId, 'logout', async () => {
      const snapshot = this.fetcher.getSnapshot();
      const agents = snapshot ? parseRegistryAgents(snapshot.data) : [];
      const agent = agents.find((a) => a.id === providerId);

      this.connectionManager.closeConnection(providerId);
      await this.authProvider.logout(providerId, agent);
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

      this.launcher.invalidateProbe(providerId, this.runtime, agent);

      // If not installed, update static catalog metadata without attempting to spawn ACP process
      if (rowBeforeProbe.installState === 'not_installed') {
        if (agent) {
          this.store.update(providerId, {
            version: agent.version,
            description: agent.description,
            icon: agent.icon ?? null,
            configOptions: JSON.stringify(agent.configOptions ?? []),
            authMethods: JSON.stringify(agent.authMethods ?? []),
          });
        }
        const row = this.store.get(providerId);
        if (!row) throw new Error(`Provider ${providerId} vanished`);
        return new Provider(row).toDiscovery();
      }

      if (agent) {
        try {
          await this.probeWithStatePreserved(
            providerId,
            agent,
            rowBeforeProbe.authState,
            'refresh',
          );
        } catch (err) {
          this.logger.warn({ err, providerId }, 'Failed to refresh probe for provider');
          this.store.setAuthState(providerId, 'error');
        }
      }

      const row = this.store.get(providerId);
      if (!row) throw new Error(`Provider ${providerId} vanished`);
      return new Provider(row).toDiscovery();
    });
  }

  async probeAllInstalledProviders(): Promise<void> {
    return this.probing.probeAllInstalledProviders((id) => this.refreshProvider(id));
  }

  async setProviderConfig(
    providerId: string,
    updates: {
      customEnv?: Record<string, string>;
      nativelyLoadsSkills?: boolean;
      defaultConfigOptions?: AgentConfigOption[];
    },
  ): Promise<ProviderDiscovery> {
    return this.runProviderOperation(providerId, 'set-config', async () => {
      const rowBeforeUpdate = this.store.get(providerId);
      if (!rowBeforeUpdate) throw new Error(`Provider ${providerId} not found`);

      if (updates.customEnv !== undefined) {
        const existingCustomEnv = jsonCodecs.stringRecord(rowBeforeUpdate.customEnv);

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

      const snapshot = this.fetcher.getSnapshot();
      const agents = snapshot ? parseRegistryAgents(snapshot.data) : [];
      const agent = agents.find((a) => a.id === providerId);

      this.launcher.invalidateProbe(providerId, this.runtime, agent);
      if (agent && rowBeforeUpdate.installState !== 'not_installed') {
        try {
          await this.probeWithStatePreserved(
            providerId,
            agent,
            rowBeforeUpdate.authState,
            'apply configuration for',
          );
        } catch (err) {
          this.logger.warn({ err, providerId }, 'Failed to probe provider after config update');
          this.store.setAuthState(providerId, 'error');
        }
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
    return this.probing.probeWithStatePreserved(providerId, agent, previousAuthState, action);
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

    const snapshot = this.fetcher.getSnapshot();
    const agents = snapshot ? parseRegistryAgents(snapshot.data) : [];
    const agent = agents.find((candidate) => candidate.id === providerId);

    if (row.installState === 'installed_local' && !this.installer.isInstalled(providerId, agent)) {
      this.logger.warn(
        { providerId, command: row.command, version: agent?.version ?? row.version },
        'Managed provider executable is missing; reinstalling',
      );
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
      const opts = jsonCodecs.agentConfigOptions(row.configOptions);
      const hasModelConfig = opts.some((opt) => opt.id === 'model' || opt.id === 'selectedModel');
      if (hasModelConfig) {
        return new Provider(row);
      }
    }

    if (agent) {
      this.launcher.invalidateProbe(providerId, this.runtime, agent);
      try {
        await this.launcher.probe(providerId, this.runtime, agent);
      } catch (err) {
        if (isAgentAuthenticationRequiredError(err)) {
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
    options?: object,
    existing?: ProviderData,
  ): ProviderDiscovery {
    return this.probing.probeAgent(agent, launch, options, existing);
  }

  dispose(): void {
    this.connectionManager.closeAll();
  }
}
