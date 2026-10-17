import { ProviderQueries } from './registry/provider-queries.js';
import { ProviderRecovery } from './registry/provider-recovery.js';
import { ProviderConfiguration } from './registry/provider-configuration.js';
import { ProviderReadiness } from './registry/provider-readiness.js';
import { createProviderData, providerDataFromRegistry } from './registry/provider-data.js';
import { type ProviderDiscovery, type RegistryAgent } from '@agentctl/shared';
import { type Logger, noopLogger } from '../logger.js';
import type { AgentDriver } from '../agent/types.js';
import type { AgentRuntimeServices } from '../agent/runtime-services.js';
import type { AgentDiagnosticsRecorder } from '../agent/diagnostics.js';
import { createAgentRuntimeServices } from '../default-agent-runtime.js';
import type { DbClient } from '../db/index.js';
import { Provider, type ProviderData } from './provider.js';
import { ProviderStore } from './registry/provider-store.js';
import { BinaryInstaller, getPlatformKey } from './registry/binary-installer.js';
import { RegistryFetcher } from './registry/registry-fetcher.js';
import { ProviderLauncher } from './registry/provider-launcher.js';
import { ProviderSync } from './registry/provider-sync.js';

import { ProviderOperationCoordinator } from './registry/provider-operation-coordinator.js';
import { ProviderProbingService } from './registry/provider-probing-service.js';
import { ProviderAuthCoordinator } from './registry/provider-auth-coordinator.js';
import { defaultCredentialVault } from '../security/credential-vault.js';
import type { AgentConnectionLifecycle } from '../agent/connection-lifecycle.js';
import {
  ProviderInstallationService,
  type ProviderInstallOptions,
} from './registry/provider-installation-service.js';
export type { ProviderInstallOptions } from './registry/provider-installation-service.js';

export { getPlatformKey };
export { parseRegistryAgents } from './registry/registry-parser.js';

export class ProviderRegistry {
  private queries: ProviderQueries;
  private recovery: ProviderRecovery;
  private configuration: ProviderConfiguration;
  private readiness: ProviderReadiness;
  private fetcher: RegistryFetcher;
  private installer: BinaryInstaller;
  private store: ProviderStore;
  private launcher: ProviderLauncher;
  private authCoordinator: ProviderAuthCoordinator;
  private syncProvider: ProviderSync;
  private runtime: AgentDriver;
  private coordinator: ProviderOperationCoordinator;
  private probing: ProviderProbingService;
  private onStateChangeCallback?: () => void;

  private activeSync?: Promise<void>;
  private connectionManager: AgentConnectionLifecycle;
  private diagnostics: AgentDiagnosticsRecorder;
  private installation: ProviderInstallationService;

  constructor(
    db: DbClient,
    private logger: Logger = noopLogger,
    runtime?: AgentDriver,
    runtimeServices?: AgentRuntimeServices,
  ) {
    const services = runtimeServices ?? createAgentRuntimeServices({ db, logger, driver: runtime });
    this.diagnostics = services.diagnostics;
    this.runtime = services.driver;
    this.fetcher = services.providers.fetcher;
    this.installer = services.providers.installer;
    this.store = services.providers.store;
    this.launcher = services.providers.launcher;
    this.connectionManager = services.connections;
    this.authCoordinator = new ProviderAuthCoordinator({
      store: this.store,
      launcher: this.launcher,
      runtime: this.runtime,
      fetcher: this.fetcher,
      connectionManager: this.connectionManager,
      logger: this.logger,
      onStateChange: () => this.onStateChangeCallback?.(),
    });
    this.syncProvider = new ProviderSync(this.fetcher, this.store, this.launcher);
    this.coordinator = new ProviderOperationCoordinator();
    this.installation = new ProviderInstallationService({
      store: this.store,
      installer: this.installer,
      launcher: this.launcher,
      runtime: this.runtime,
      logger: this.logger,
      coordinator: this.coordinator,
      getAgent: (id, fallback) => this.getAgent(id, fallback),
      onStateChange: () => this.notifyStateChange(),
    });
    this.probing = new ProviderProbingService(
      this.store,
      this.fetcher,
      this.launcher,
      this.runtime,
      this.logger,
    );
    this.queries = new ProviderQueries({
      store: this.store,
      fetcher: this.fetcher,
      withInstallProgress: (item) => this.withInstallProgress(item),
    });
    this.recovery = new ProviderRecovery({
      store: this.store,
      fetcher: this.fetcher,
      installer: this.installer,
      logger,
      notifyStateChange: () => this.notifyStateChange(),
    });
    this.configuration = new ProviderConfiguration({
      store: this.store,
      authCoordinator: this.authCoordinator,
      connectionManager: this.connectionManager,
      runtime: this.runtime,
      launcher: this.launcher,
      coordinator: this.coordinator,
      logger,
      notifyStateChange: () => this.notifyStateChange(),
      getProvider: (id) => this.getProvider(id),
      getAgent: (id, row) => this.getAgent(id, row),
      probeWithStatePreserved: (...args) => this.probeWithStatePreserved(...args),
    });
    this.readiness = new ProviderReadiness({
      store: this.store,
      authCoordinator: this.authCoordinator,
      installer: this.installer,
      launcher: this.launcher,
      runtime: this.runtime,
      logger,
      sync: () => this.sync(),
      install: (id) => this.install(id),
      getAgent: (id, row) => this.getAgent(id, row),
      probeWithStatePreserved: (...args) => this.probeWithStatePreserved(...args),
    });
  }

  getAuthCoordinator(): ProviderAuthCoordinator {
    return this.authCoordinator;
  }

  setOnStateChange(cb: () => void): void {
    this.onStateChangeCallback = cb;
  }

  private notifyStateChange(): void {
    try {
      this.onStateChangeCallback?.();
    } catch (error) {
      this.logger.error(error, 'Failed to publish provider state change');
    }
  }

  private withInstallProgress(discovery: ProviderDiscovery): ProviderDiscovery {
    return {
      ...this.installation.withProgress(discovery),
      authInteraction: this.authCoordinator.getAuthInteraction(discovery.id),
    };
  }

  getConnectionManager(): AgentConnectionLifecycle {
    return this.connectionManager;
  }

  getTransportDiagnostics() {
    return this.diagnostics.snapshot(this.connectionManager.getConnectionDiagnostics());
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
    return this.installer.getInstallDir(this.store.get(providerId)?.registryAgentId ?? providerId);
  }

  install(providerId: string, options: ProviderInstallOptions = {}): Promise<ProviderDiscovery> {
    const registryId = this.store.get(providerId)?.registryAgentId;
    if (registryId)
      return this.installation
        .install(registryId, options)
        .then(() => this.getProvider(providerId)!.toDiscovery());
    return this.installation.install(providerId, options);
  }

  cancelInstall(providerId: string): void {
    this.installation.cancelInstall(this.store.get(providerId)?.registryAgentId ?? providerId);
  }

  async remove(providerId: string): Promise<ProviderDiscovery> {
    if (this.store.get(providerId)?.registryAgentId) return this.removeProfile(providerId);
    if (this.store.listAll().some((row) => row.registryAgentId === providerId && !row.hidden)) {
      throw new Error('Remove the configured profiles before uninstalling this agent');
    }
    // Cancellation must happen before queueing; otherwise removal would wait for
    // the operation it is trying to stop.
    this.cancelInstall(providerId);
    this.authCoordinator.cancelLogin(providerId);
    return this.runProviderOperation(providerId, 'remove', () => this.doRemove(providerId));
  }

  private async doRemove(providerId: string): Promise<ProviderDiscovery> {
    const provider = this.store.get(providerId);
    if (!provider) throw new Error(`Provider ${providerId} not found`);

    const agent = this.getAgent(providerId, provider);
    const wasDefault = this.store.getDefaultProviderId() === providerId;

    this.cancelInstall(providerId);
    this.authCoordinator.cancelLogin(providerId);
    this.connectionManager.closeConnection(providerId);
    this.launcher.invalidateProbe(providerId, this.runtime, agent);

    if (provider.installState === 'installed_local') {
      await this.installer.remove(providerId, this.logger);
    } else {
      await this.installer.removeStaging(providerId, this.logger);
    }

    const vaultSnapshot = defaultCredentialVault.snapshotProviderSecrets(providerId);
    await defaultCredentialVault.deleteProviderSecrets(providerId);
    try {
      this.store.delete(providerId);
    } catch (error) {
      await defaultCredentialVault.restoreProviderSecrets(providerId, vaultSnapshot);
      throw error;
    }

    if (wasDefault) {
      const nextDefault = this.store
        .list()
        .find((candidate) => candidate.enabled && candidate.installState !== 'not_installed');
      this.setDefaultProvider(nextDefault?.id ?? null);
    }

    const synthetic = agent
      ? providerDataFromRegistry(agent)
      : createProviderData({
          id: providerId,
          name: provider.name,
          version: provider.version,
          description: provider.description,
          icon: provider.icon,
        });

    return new Provider(synthetic).toDiscovery();
  }

  async login(providerId: string, methodId: string): Promise<void> {
    return this.runProviderOperation(providerId, `login:${methodId}`, async () => {
      await this.authCoordinator.login(providerId, methodId);
    });
  }

  cancelLogin(providerId: string): void {
    this.authCoordinator.cancelLogin(providerId);
  }

  async verify(providerId: string): Promise<ProviderDiscovery> {
    return this.runProviderOperation(providerId, 'verify', async () => {
      await this.authCoordinator.verify(providerId);
      const row = this.store.get(providerId);
      if (!row) throw new Error(`Provider ${providerId} not found`);
      return new Provider(row).toDiscovery();
    });
  }

  async logout(providerId: string): Promise<void> {
    return this.runProviderOperation(providerId, 'logout', async () => {
      await this.authCoordinator.logout(providerId);
    });
  }

  async activate(providerId: string): Promise<ProviderDiscovery> {
    return this.runProviderOperation(providerId, 'activate', async () => {
      const row = this.store.get(providerId);
      if (!row) throw new Error(`Provider ${providerId} not found`);

      if (row.authState === 'unknown' && row.installState !== 'not_installed') {
        const agent = this.getAgent(providerId, row);
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

      const agent = this.getAgent(providerId, rowBeforeProbe);

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
        }
      }

      const row = this.store.get(providerId);
      if (!row) throw new Error(`Provider ${providerId} vanished`);
      return new Provider(row).toDiscovery();
    });
  }

  autoUpdateInstalledProviders(): Promise<void> {
    return this.installation.autoUpdateInstalledProviders((id, options) =>
      this.install(id, options),
    );
  }

  async probeAllInstalledProviders(): Promise<void> {
    return this.probing.probeAllInstalledProviders((id) => this.refreshProvider(id));
  }

  private async probeWithStatePreserved(
    providerId: string,
    agent: RegistryAgent,
    previousAuthState: ProviderData['authState'],
    action: string,
  ): Promise<void> {
    try {
      await this.probing.probeWithStatePreserved(providerId, agent, previousAuthState, action);
    } finally {
      this.notifyStateChange();
    }
  }

  async sync(): Promise<void> {
    if (this.activeSync) return this.activeSync;

    const promise = this.runSync(async () => {
      await this.syncProvider.sync();
      this.notifyStateChange();
    });
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

  updateSetting(key: string, value: string): void {
    this.store.updateSetting(key, value);
  }

  probeAgent(
    agent: RegistryAgent,
    launch: { command: string; args: string[]; env: Record<string, string> },
    options?: object,
    existing?: ProviderData,
  ): ProviderDiscovery {
    return this.probing.probeAgent(agent, launch, options, existing);
  }

  private disposal?: Promise<void>;
  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.coordinator.stop();
    this.installation.dispose();
    const authentication = this.authCoordinator.dispose();
    this.connectionManager.closeAll();
    this.disposal = Promise.allSettled([authentication, this.coordinator.idle()]).then(async () => {
      this.connectionManager.closeAll();
      await this.connectionManager.dispose?.();
    });
    return this.disposal;
  }
  private getAgent(providerId: string, fallback?: ProviderData): RegistryAgent | undefined {
    return this.queries.getAgent(providerId, fallback);
  }
  discover(): Promise<ProviderDiscovery[]> {
    return this.queries.discover();
  }
  catalog(): Promise<ProviderDiscovery[]> {
    return this.queries.catalog();
  }
  getProvider(id: string): Provider | undefined {
    return this.queries.getProvider(id);
  }
  getSettings(): Record<string, string | undefined> {
    return this.queries.getSettings();
  }
  recoverInterruptedOperations(): Promise<void> {
    return this.recovery.recoverInterruptedOperations();
  }
  createProfile(providerId: string, name: string): Promise<ProviderDiscovery> {
    return this.configuration.createProfile(providerId, name);
  }
  removeProfile(providerId: string): Promise<ProviderDiscovery> {
    return this.configuration.removeProfile(providerId);
  }
  setProviderConfig(
    ...args: Parameters<ProviderConfiguration['setProviderConfig']>
  ): Promise<ProviderDiscovery> {
    return this.configuration.setProviderConfig(...args);
  }
  setDefaultProvider(id: string | null | undefined): void {
    this.configuration.setDefaultProvider(id);
  }
  ensureProviderReady(providerId: string, options: { force?: boolean } = {}): Promise<Provider> {
    return this.readiness.ensureProviderReady(providerId, options);
  }
  listNativeSessions(providerId: string, cwd: string, cursor?: string) {
    return this.readiness.listNativeSessions(providerId, cwd, cursor);
  }
}
