import {
  type ProviderDiscovery,
  type RegistryAgent,
  type AgentConfigOption,
} from '@agentctl/shared';
import path from 'node:path';
import { type Logger, noopLogger } from '../logger.js';
import type { AgentDriver } from '../agent/types.js';
import type { AgentRuntimeServices } from '../agent/runtime-services.js';
import type { AgentDiagnosticsRecorder } from '../agent/diagnostics.js';
import {
  createDefaultAgentConnectionManager,
  createDefaultAgentDriver,
  defaultAgentDiagnostics,
} from '../default-agent-driver.js';
import type { DbClient } from '../db/index.js';
import { jsonCodecs } from '../db/json-codecs.js';
import { Provider, type ProviderData } from './provider.js';
import { ProviderStore } from './registry/provider-store.js';
import { BinaryInstaller, getPlatformKey } from './registry/binary-installer.js';
import { RegistryFetcher } from './registry/registry-fetcher.js';
import {
  ProviderLauncher,
  probeResultUpdate,
  resolveNpxPackageSpec,
  resolveUvxPackageSpec,
} from './registry/provider-launcher.js';
import { ProviderSync } from './registry/provider-sync.js';

import { ProviderOperationCoordinator } from './registry/provider-operation-coordinator.js';
import { ProviderProbingService } from './registry/provider-probing-service.js';
import { parseRegistryAgents } from './registry/registry-parser.js';
import { ProviderAuthCoordinator } from './registry/provider-auth-coordinator.js';
import { defaultCredentialVault } from '../security/credential-vault.js';
import type { AgentConnectionManager } from '../acp/types.js';
import {
  ProviderLifecycleError,
  type ProviderLifecycleErrorCode,
} from './registry/provider-lifecycle-error.js';

export { getPlatformKey };
export { parseRegistryAgents } from './registry/registry-parser.js';

export class ProviderRegistry {
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
  private connectionManager: AgentConnectionManager;
  private diagnostics: AgentDiagnosticsRecorder;
  private installControllers = new Map<string, AbortController>();

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
    this.probing = new ProviderProbingService(
      this.store,
      this.fetcher,
      this.launcher,
      this.runtime,
      this.logger,
    );
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

  private getAgent(providerId: string, fallback?: ProviderData): RegistryAgent | undefined {
    const snapshot = this.fetcher.getSnapshot();
    if (snapshot) {
      try {
        const agent = parseRegistryAgents(snapshot.data).find(
          (candidate) => candidate.id === providerId,
        );
        if (agent) return agent;
      } catch (error) {
        this.logger.warn({ error }, 'Ignoring invalid provider registry snapshot');
      }
    }
    const row = fallback ?? this.store.get(providerId);
    return row ? new Provider(row).toDiscovery().agent : undefined;
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
      await this.sync().catch((error: unknown) => {
        this.logger.warn({ error }, 'Initial provider registry sync failed');
      });
      rows = this.store.list();
      if (rows.length === 0) {
        this.logger.warn('Provider registry sync completed without any discoverable providers');
        return [];
      }
    }

    // Auto-probe any installed & ready providers that have empty/missing model options
    const unprobedInstalled = rows.filter((row) => {
      if (
        row.installState === 'not_installed' ||
        row.authState === 'required' ||
        row.authState === 'error' ||
        row.authState === 'authenticating' ||
        row.authState === 'verifying'
      ) {
        return false;
      }
      if (row.lastVerifiedAt && Date.now() - row.lastVerifiedAt.getTime() < 5 * 60_000) {
        return false;
      }
      const opts = jsonCodecs.agentConfigOptions(row.configOptions);
      const hasModel = opts.some((o) => o.id === 'model' || o.id === 'selectedModel');
      return !hasModel;
    });

    if (unprobedInstalled.length > 0) {
      for (const row of unprobedInstalled) {
        const agent = this.getAgent(row.id, row);
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
    const cachedAgents = this.fetcher.getCachedAgents();
    let agents: RegistryAgent[];
    try {
      agents = cachedAgents ?? (await this.fetcher.fetch());
      if (!cachedAgents) this.store.deleteSetting('registrySyncError');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.store.updateSetting('registrySyncError', message);
      this.logger.warn({ error }, 'Provider catalog refresh failed; using persisted providers');
      return this.store.list().map((row) => new Provider(row).toDiscovery());
    }
    if (cachedAgents) {
      void this.sync().catch((error: unknown) => {
        this.logger.debug({ error }, 'Background registry refresh failed');
      });
    }
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
    const agent = this.getAgent(providerId);
    if (!agent) {
      throw new Error(`Agent ${providerId} not found in registry`);
    }

    const previous = this.store.get(providerId);
    const hadWorkingInstall =
      previous?.installState === 'installed_local' || previous?.installState === 'system_available';
    const controller = new AbortController();

    // Mark the operation without discarding the last known-good launch or credentials.
    this.store.upsert(providerId, {
      name: agent.name,
      version: agent.version,
      description: agent.description,
      icon: agent.icon ?? null,
      distribution: JSON.stringify(agent.distribution),
      command: previous?.command ?? providerId,
      installState: hadWorkingInstall ? previous.installState : 'installing',
      installError: null,
      installStage: 'preparing',
      authState:
        previous?.authState === 'needs_auth' ? 'required' : (previous?.authState ?? 'unknown'),
      ...(hadWorkingInstall
        ? {}
        : {
            configOptions: JSON.stringify(agent.configOptions ?? []),
            authMethods: JSON.stringify(agent.authMethods ?? []),
            supportsDynamicModel: agent.supportsDynamicModel ?? false,
            supportsDynamicConfig: agent.supportsDynamicConfig ?? false,
            supportsLogout: agent.supportsLogout ?? false,
          }),
    });
    this.installControllers.set(providerId, controller);

    const platform = getPlatformKey();
    const binary = agent.distribution.binary;
    const platformTarget = binary ? binary[platform] : undefined;

    let installState: 'installed_local' | 'system_available';
    let command: string;
    let launchArgs: string[];
    let launchEnv: Record<string, string>;
    let installSource: 'managed' | 'system' | 'npx' | 'uvx';
    let installedVersion: string | null;
    let managedVersionDir: string | undefined;
    let managedVersionDiscarded = false;

    const discardManagedCandidate = async () => {
      if (!managedVersionDir || managedVersionDiscarded) return;
      const relativePreviousCommand = previous
        ? path.relative(managedVersionDir, previous.command)
        : null;
      const candidateWasAlreadyActive =
        relativePreviousCommand !== null &&
        relativePreviousCommand.length > 0 &&
        !relativePreviousCommand.startsWith(`..${path.sep}`) &&
        relativePreviousCommand !== '..' &&
        !path.isAbsolute(relativePreviousCommand);
      if (candidateWasAlreadyActive) return;

      managedVersionDiscarded = true;
      await this.installer
        .removeVersionedDir(providerId, managedVersionDir, this.logger)
        .catch((error: unknown) => {
          this.logger.warn({ error, providerId }, 'Failed to discard rejected provider version');
        });
    };

    const setStage = (
      stage: 'preparing' | 'downloading' | 'verifying' | 'extracting' | 'activating' | 'connecting',
    ) => {
      this.store.setInstallDetails(providerId, { stage });
      this.notifyStateChange();
    };

    try {
      const previousSource = previous?.installSource;
      const detected =
        !previousSource || previousSource === 'system'
          ? await this.launcher.detectSystemBinary(agent, platform)
          : null;
      const desiredSource =
        previousSource === 'managed' && platformTarget
          ? 'managed'
          : previousSource === 'npx' && agent.distribution.npx
            ? 'npx'
            : previousSource === 'uvx' && agent.distribution.uvx
              ? 'uvx'
              : detected
                ? 'system'
                : platformTarget
                  ? 'managed'
                  : agent.distribution.npx
                    ? 'npx'
                    : agent.distribution.uvx
                      ? 'uvx'
                      : null;

      if (desiredSource === 'system' && detected) {
        this.logger.info(
          { providerId, detectedCommand: detected.command },
          'Detected agent binary on local system PATH',
        );
        installState = 'system_available';
        command = detected.command;
        launchArgs = detected.args ?? [];
        launchEnv = {};
        installSource = 'system';
        installedVersion = null;
      } else if (desiredSource === 'managed' && platformTarget) {
        const result = await this.installer.install(agent, platform, this.logger, {
          signal: controller.signal,
          onStage: setStage,
        });
        installState = 'installed_local';
        command = result.command;
        launchArgs = result.args;
        launchEnv = result.env;
        installSource = 'managed';
        installedVersion = agent.version;
        managedVersionDir = result.versionedDir;
      } else if (desiredSource === 'npx' && agent.distribution.npx) {
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
        installSource = 'npx';
        installedVersion = agent.version;
      } else if (desiredSource === 'uvx' && agent.distribution.uvx) {
        const onPath = await this.launcher.isBinaryOnPath('uvx');
        if (!onPath) {
          throw new Error('uvx not found on PATH. Install uv first.');
        }
        installState = 'system_available';
        command = 'uvx';
        launchArgs = [
          resolveUvxPackageSpec(agent.distribution.uvx.package, agent.version),
          ...(agent.distribution.uvx.args ?? []),
        ];
        launchEnv = agent.distribution.uvx.env;
        installSource = 'uvx';
        installedVersion = agent.version;
      } else if (binary) {
        throw new Error(`Agent ${providerId} binary not available for platform ${platform}`);
      } else {
        throw new Error(`Agent ${providerId} does not support installation`);
      }

      const candidateValues = {
        name: agent.name,
        version: agent.version,
        description: agent.description,
        icon: agent.icon ?? null,
        distribution: JSON.stringify(agent.distribution),
        command,
        launchArgs: JSON.stringify(launchArgs),
        launchEnv: JSON.stringify(launchEnv),
        configOptions: JSON.stringify(agent.configOptions ?? []),
        authMethods: JSON.stringify(agent.authMethods ?? []),
        installState,
        installError: null,
        installStage: null,
        installSource,
        installedVersion,
        supportsDynamicModel: agent.supportsDynamicModel ?? false,
        supportsDynamicConfig: agent.supportsDynamicConfig ?? false,
        supportsLogout: agent.supportsLogout ?? false,
      } as const;

      setStage('connecting');
      this.launcher.invalidateProbe(providerId, this.runtime, agent);
      let probeSucceeded = false;
      try {
        const rowForProbe = this.store.get(providerId);
        if (!rowForProbe) throw new Error(`Provider ${providerId} vanished during install`);
        const candidateRow: ProviderData = {
          ...rowForProbe,
          ...candidateValues,
          launchArgs: JSON.stringify(launchArgs),
          launchEnv: JSON.stringify(launchEnv),
        };
        const candidateLaunch = this.launcher.resolveLaunchFromBase(candidateRow, {
          command,
          args: launchArgs,
          env: launchEnv,
        });
        const probeResult = await this.launcher.inspectLaunch(
          providerId,
          this.runtime,
          candidateLaunch,
          installedVersion ?? agent.version,
        );
        controller.signal.throwIfAborted();
        this.store.upsert(providerId, {
          ...candidateValues,
          ...probeResultUpdate(probeResult, candidateRow),
        });
        probeSucceeded = true;
      } catch (probeErr) {
        if (controller.signal.aborted) {
          throw controller.signal.reason;
        }
        const message = probeErr instanceof Error ? probeErr.message : String(probeErr);
        this.logger.warn({ probeErr, providerId }, 'Install probe verification failed for agent');
        if (hadWorkingInstall && previous) {
          await discardManagedCandidate();
          this.store.update(providerId, {
            command: previous.command,
            launchArgs: previous.launchArgs,
            launchEnv: previous.launchEnv,
            installState: previous.installState,
            installStage: null,
            installSource: previous.installSource,
            installedVersion: previous.installedVersion,
            installError: `ACP_HANDSHAKE_FAILED: ${message}`,
            authState: previous.authState === 'needs_auth' ? 'required' : previous.authState,
            connectionState: previous.connectionState,
          });
        } else {
          // The first installation succeeded. Report connection/auth health independently.
          this.store.upsert(providerId, {
            ...candidateValues,
            connectionState: 'error',
            authError: JSON.stringify({
              code: 'ACP_HANDSHAKE_FAILED',
              message: `Provider installed, but its ACP handshake failed: ${message}`,
              retryable: true,
            }),
          });
        }
      }

      controller.signal.throwIfAborted();

      if (managedVersionDir && probeSucceeded) {
        await this.installer.removeStaleVersionedDirs(providerId, managedVersionDir, this.logger);
      }

      if (probeSucceeded) {
        this.store.setInstallDetails(providerId, { stage: null, error: null });
      }

      const row = this.store.get(providerId);
      if (!row) throw new Error(`Provider ${providerId} vanished`);
      return new Provider(row).toDiscovery();
    } catch (err) {
      await discardManagedCandidate();
      const msg = err instanceof Error ? err.message : String(err);
      const code: ProviderLifecycleErrorCode =
        err instanceof ProviderLifecycleError
          ? err.code
          : controller.signal.aborted
            ? 'INSTALL_CANCELLED'
            : 'ACTIVATION_FAILED';
      if (code === 'INSTALL_CANCELLED') {
        if (
          previous &&
          (previous.installState === 'installed_local' ||
            previous.installState === 'system_available')
        ) {
          this.store.update(providerId, {
            command: previous.command,
            launchArgs: previous.launchArgs,
            launchEnv: previous.launchEnv,
            installState: previous.installState,
            installStage: null,
            installSource: previous.installSource,
            installedVersion: previous.installedVersion,
            installError: previous.installError,
            authState: previous.authState === 'needs_auth' ? 'required' : previous.authState,
            connectionState: previous.connectionState,
          });
        } else {
          this.store.setInstallDetails(providerId, {
            state: 'not_installed',
            stage: null,
            source: null,
            installedVersion: null,
            error: null,
          });
        }
        const cancelledRow = this.store.get(providerId);
        if (!cancelledRow) throw err;
        return new Provider(cancelledRow).toDiscovery();
      }
      if (
        previous &&
        (previous.installState === 'installed_local' ||
          previous.installState === 'system_available')
      ) {
        this.store.update(providerId, {
          command: previous.command,
          launchArgs: previous.launchArgs,
          launchEnv: previous.launchEnv,
          installState: previous.installState,
          installStage: null,
          installSource: previous.installSource,
          installedVersion: previous.installedVersion,
          installError: `${code}: ${msg}`,
          authState: previous.authState === 'needs_auth' ? 'required' : previous.authState,
          connectionState: previous.connectionState,
        });
      } else {
        this.store.setInstallDetails(providerId, {
          state: 'failed',
          stage: null,
          error: `${code}: ${msg}`,
        });
      }
      throw err instanceof ProviderLifecycleError
        ? err
        : new ProviderLifecycleError(code, msg, { cause: err });
    } finally {
      if (this.installControllers.get(providerId) === controller) {
        this.installControllers.delete(providerId);
      }
      this.notifyStateChange();
    }
  }

  cancelInstall(providerId: string): void {
    this.installControllers.get(providerId)?.abort(new Error('Install cancelled'));
    const agent = this.getAgent(providerId);
    this.launcher.invalidateProbe(providerId, this.runtime, agent);
  }

  async remove(providerId: string): Promise<ProviderDiscovery> {
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
          connectionState: 'unknown',
          authError: null,
          lastVerifiedAt: null,
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
          connectionState: 'unknown',
          authError: null,
          lastVerifiedAt: null,
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

  async probeAllInstalledProviders(): Promise<void> {
    return this.probing.probeAllInstalledProviders((id) => this.refreshProvider(id));
  }

  async recoverInterruptedOperations(): Promise<void> {
    const snapshot = this.fetcher.getSnapshot();
    let agents: RegistryAgent[] = [];
    if (snapshot) {
      try {
        agents = parseRegistryAgents(snapshot.data);
      } catch (error) {
        this.logger.warn({ error }, 'Recovering providers without invalid registry snapshot');
      }
    }
    let changed = false;

    await this.installer.removeStaleStaging(this.logger).catch((error: unknown) => {
      this.logger.warn({ error }, 'Failed to clean orphaned provider staging directories');
    });

    for (const row of this.store.listAll()) {
      const agent = agents.find((candidate) => candidate.id === row.id);
      if (row.installState === 'installing') {
        const hasPreviousInstall =
          !!row.installedVersion ||
          row.installSource === 'system' ||
          row.installSource === 'npx' ||
          row.installSource === 'uvx';
        const hasCurrentManagedInstall = !!agent && this.installer.isInstalled(row.id, agent);
        const interruptedError =
          'INSTALL_INTERRUPTED: Installation was interrupted by application shutdown';

        if (!hasPreviousInstall && hasCurrentManagedInstall && agent) {
          const target = agent.distribution.binary?.[getPlatformKey()];
          if (target) {
            const versionedDir = this.installer.getVersionedInstallDir(
              agent.id,
              agent.version,
              target.archive,
            );
            this.store.update(row.id, {
              command: path.resolve(versionedDir, target.cmd),
              launchArgs: JSON.stringify(target.args ?? []),
              launchEnv: JSON.stringify(target.env),
              installState: 'installed_local',
              installStage: null,
              installSource: 'managed',
              installedVersion: agent.version,
              installError: interruptedError,
            });
          }
        } else {
          this.store.setInstallDetails(row.id, {
            state: hasPreviousInstall
              ? row.installSource === 'managed'
                ? 'installed_local'
                : 'system_available'
              : 'failed',
            stage: null,
            source: row.installSource,
            installedVersion: row.installedVersion,
            error: interruptedError,
          });
        }
        changed = true;
      } else if (row.installStage !== null && row.installStage !== undefined) {
        this.store.setInstallDetails(row.id, {
          stage: null,
          error: 'INSTALL_INTERRUPTED: Installation was interrupted by application shutdown',
        });
        changed = true;
      }

      if (row.authState === 'authenticating' || row.authState === 'verifying') {
        const authError = {
          code: 'AUTH_INTERRUPTED',
          message: 'Authentication was interrupted by application shutdown',
          retryable: true,
        };
        this.store.setAuthDetails(row.id, {
          authState: 'required',
          connectionState: 'unknown',
          authError: JSON.stringify(authError),
        });
        changed = true;
      } else if (row.connectionState === 'checking') {
        this.store.setAuthDetails(row.id, { connectionState: 'unknown' });
        changed = true;
      }
    }

    if (changed) this.notifyStateChange();
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
        const merged: Record<string, string> = { ...existingCustomEnv };
        const vaultSnapshot = defaultCredentialVault.snapshotProviderSecrets(providerId);
        const secretUpdates: Record<string, string | null> = {};
        for (const [key, value] of Object.entries(updates.customEnv)) {
          secretUpdates[key] = value.trim().length === 0 ? null : value;
        }
        try {
          const refs = await defaultCredentialVault.setProviderSecrets(providerId, secretUpdates);
          for (const [key, value] of Object.entries(updates.customEnv)) {
            if (value.trim().length === 0) delete merged[key];
            else merged[key] = refs[key];
          }
          this.store.setCustomEnv(providerId, merged);
        } catch (error) {
          await defaultCredentialVault.restoreProviderSecrets(providerId, vaultSnapshot);
          throw error;
        }
      }
      if (updates.nativelyLoadsSkills !== undefined) {
        this.store.update(providerId, { nativelyLoadsSkills: updates.nativelyLoadsSkills });
      }
      if (updates.defaultConfigOptions !== undefined) {
        this.store.setDefaultConfigOptions(providerId, updates.defaultConfigOptions);
      }

      const agent = this.getAgent(providerId, rowBeforeUpdate);

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

    const agent = this.getAgent(providerId, row);

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

    if (!options.force && row.authState === 'required') {
      return new Provider(row);
    }

    if (!options.force && row.authState === 'not_required' && row.connectionState === 'ready') {
      return new Provider(row);
    }

    if (!options.force && row.authState === 'authenticated' && row.connectionState === 'ready') {
      const opts = jsonCodecs.agentConfigOptions(row.configOptions);
      const hasModelConfig = opts.some((opt) => opt.id === 'model' || opt.id === 'selectedModel');
      const recentlyVerified =
        !!row.lastVerifiedAt && Date.now() - row.lastVerifiedAt.getTime() < 5 * 60_000;
      if (hasModelConfig || recentlyVerified) {
        return new Provider(row);
      }
    }

    if (agent) {
      this.launcher.invalidateProbe(providerId, this.runtime, agent);
      await this.probeWithStatePreserved(providerId, agent, row.authState, 'prepare');
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
      'defaultToWorktree',
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
    for (const controller of this.installControllers.values()) {
      controller.abort(new Error('Application shutting down'));
    }
    this.installControllers.clear();
    this.authCoordinator.dispose();
    this.connectionManager.closeAll();
  }
}
