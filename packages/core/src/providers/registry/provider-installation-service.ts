import { ProviderUpdates } from './provider-updates.js';
import { registryProviderMetadata } from './provider-data.js';
import type { ProviderDiscovery, RegistryAgent } from '@agentctl/shared';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Logger } from '../../logger.js';
import type { AgentDriver } from '../../agent/types.js';
import { Provider, type ProviderData } from '../provider.js';
import type { ProviderStore } from './provider-store.js';
import { getHome, getPlatformKey, type BinaryInstaller } from './binary-installer.js';
import {
  probeResultUpdate,
  resolveNpxPackageSpec,
  resolveUvxPackageSpec,
  type ProviderLauncher,
} from './provider-launcher.js';
import type { ProviderOperationCoordinator } from './provider-operation-coordinator.js';
import {
  ProviderLifecycleError,
  type ProviderLifecycleErrorCode,
} from './provider-lifecycle-error.js';

const execFileAsync = promisify(execFile);
export interface ProviderInstallOptions {
  prewarmNpx?: boolean;
}
interface InstallationDependencies {
  store: ProviderStore;
  installer: BinaryInstaller;
  launcher: ProviderLauncher;
  runtime: AgentDriver;
  logger: Logger;
  coordinator: ProviderOperationCoordinator;
  getAgent: (id: string, fallback?: ProviderData) => RegistryAgent | undefined;
  onStateChange: () => void;
}

/** Owns installation candidates, verification, rollback, and cancellation. */
export class ProviderInstallationService {
  private installControllers = new Map<string, AbortController>();
  private installProgress = new Map<
    string,
    { downloadedBytes: number; totalBytes: number | null }
  >();
  constructor(private readonly deps: InstallationDependencies) {}

  withProgress(discovery: ProviderDiscovery): ProviderDiscovery {
    return { ...discovery, installProgress: this.installProgress.get(discovery.id) ?? null };
  }

  async install(
    providerId: string,
    options: ProviderInstallOptions = {},
  ): Promise<ProviderDiscovery> {
    return this.deps.coordinator.runProviderOperation(providerId, 'install', () =>
      this.doInstall(providerId, { prewarmNpx: true, ...options }),
    );
  }

  private async doInstall(
    providerId: string,
    options: ProviderInstallOptions,
  ): Promise<ProviderDiscovery> {
    const agent = this.deps.getAgent(providerId);
    if (!agent) {
      throw new Error(`Agent ${providerId} not found in registry`);
    }

    const previous = this.deps.store.get(providerId);
    const hadWorkingInstall =
      previous?.installState === 'installed_local' || previous?.installState === 'system_available';
    const controller = new AbortController();

    // Mark the operation without discarding the last known-good launch or credentials.
    this.deps.store.upsert(providerId, {
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
    this.installProgress.delete(providerId);
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
    let candidateNpxCache: string | undefined;

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
      await this.deps.installer
        .removeVersionedDir(providerId, managedVersionDir, this.deps.logger)
        .catch((error: unknown) => {
          this.deps.logger.warn(
            { error, providerId },
            'Failed to discard rejected provider version',
          );
        });
    };

    const discardNpxCandidate = async () => {
      if (!candidateNpxCache) return;
      await fs.rm(candidateNpxCache, { recursive: true, force: true }).catch((error: unknown) => {
        this.deps.logger.warn({ error, providerId }, 'Failed to discard rejected npx cache');
      });
      candidateNpxCache = undefined;
    };

    const restorePreviousInstall = (installError: string | null): boolean => {
      if (!hadWorkingInstall || !previous) return false;
      this.deps.store.update(providerId, {
        command: previous.command,
        launchArgs: previous.launchArgs,
        launchEnv: previous.launchEnv,
        installState: previous.installState,
        installStage: null,
        installSource: previous.installSource,
        installedVersion: previous.installedVersion,
        installError,
        authState: previous.authState === 'needs_auth' ? 'required' : previous.authState,
        connectionState: previous.connectionState,
      });
      return true;
    };

    const setStage = (
      stage: 'preparing' | 'downloading' | 'verifying' | 'extracting' | 'activating' | 'connecting',
    ) => {
      this.deps.store.setInstallDetails(providerId, { stage });
      this.deps.onStateChange();
    };

    try {
      const previousSource = previous?.installSource;
      const detected =
        !previousSource || previousSource === 'system'
          ? await this.deps.launcher.detectSystemBinary(agent, platform)
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
        this.deps.logger.info(
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
        const result = await this.deps.installer.install(agent, platform, this.deps.logger, {
          signal: controller.signal,
          onStage: setStage,
          onProgress: (progress) => {
            this.installProgress.set(providerId, progress);
            this.deps.onStateChange();
          },
        });
        installState = 'installed_local';
        command = result.command;
        launchArgs = result.args;
        launchEnv = result.env;
        installSource = 'managed';
        installedVersion = agent.version;
        managedVersionDir = result.versionedDir;
      } else if (desiredSource === 'npx' && agent.distribution.npx) {
        const onPath = await this.deps.launcher.isBinaryOnPath('npx');
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
        if (options.prewarmNpx) {
          // Finish npm's cold download before the short ACP handshake probe.
          // Each attempt gets its own cache, so an interrupted install cannot poison retries.
          const cacheKey = crypto
            .createHash('sha256')
            .update(`${providerId}\0${agent.version}`)
            .digest('hex')
            .slice(0, 20);
          const cacheRoot = path.join(getHome(), 'provider-npx-cache');
          await fs.mkdir(cacheRoot, { recursive: true });
          candidateNpxCache = await fs.mkdtemp(path.join(cacheRoot, `${cacheKey}-`));
          launchEnv = { ...launchEnv, npm_config_cache: candidateNpxCache };
          const packageSpec = launchArgs[1];
          if (!packageSpec || !/^[a-zA-Z0-9@/._+~-]+$/.test(packageSpec)) {
            throw new Error(`Unsafe npx package spec for provider ${providerId}`);
          }
          await execFileAsync(
            process.platform === 'win32' ? 'npm.cmd' : 'npm',
            ['exec', '--yes', `--package=${packageSpec}`, '--', 'node', '--version'],
            {
              cwd: os.tmpdir(),
              env: { ...process.env, ...launchEnv },
              signal: controller.signal,
              timeout: 10 * 60_000,
              maxBuffer: 1024 * 1024,
              shell: process.platform === 'win32',
            },
          );
        }
      } else if (desiredSource === 'uvx' && agent.distribution.uvx) {
        const onPath = await this.deps.launcher.isBinaryOnPath('uvx');
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
        ...registryProviderMetadata(agent),
        command,
        launchArgs: JSON.stringify(launchArgs),
        launchEnv: JSON.stringify(launchEnv),
        installState,
        installError: null,
        installStage: null,
        installSource,
        installedVersion,
      } as const;

      setStage('connecting');
      this.deps.launcher.invalidateProbe(providerId, this.deps.runtime, agent);
      let probeSucceeded = false;
      try {
        const rowForProbe = this.deps.store.get(providerId);
        if (!rowForProbe) throw new Error(`Provider ${providerId} vanished during install`);
        const candidateRow: ProviderData = {
          ...rowForProbe,
          ...candidateValues,
        };
        const candidateLaunch = this.deps.launcher.resolveLaunchFromBase(candidateRow, {
          command,
          args: launchArgs,
          env: launchEnv,
        });
        const probeResult = await this.deps.launcher.inspectLaunch(
          providerId,
          this.deps.runtime,
          candidateLaunch,
          installedVersion ?? agent.version,
        );
        controller.signal.throwIfAborted();
        this.deps.store.upsert(providerId, {
          ...candidateValues,
          ...probeResultUpdate(probeResult, candidateRow),
        });
        probeSucceeded = true;
      } catch (probeErr) {
        if (controller.signal.aborted) {
          throw controller.signal.reason;
        }
        const message = probeErr instanceof Error ? probeErr.message : String(probeErr);
        this.deps.logger.warn(
          { probeErr, providerId },
          'Install probe verification failed for agent',
        );
        if (hadWorkingInstall) {
          await discardManagedCandidate();
          await discardNpxCandidate();
          restorePreviousInstall(`ACP_HANDSHAKE_FAILED: ${message}`);
        } else {
          // The first installation succeeded. Report connection/auth health independently.
          this.deps.store.upsert(providerId, {
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
        await this.deps.installer.removeStaleVersionedDirs(
          providerId,
          managedVersionDir,
          this.deps.logger,
        );
      }

      if (probeSucceeded) {
        this.deps.store.setInstallDetails(providerId, { stage: null, error: null });
      }

      const row = this.deps.store.get(providerId);
      if (!row) throw new Error(`Provider ${providerId} vanished`);
      return new Provider(row).toDiscovery();
    } catch (err) {
      await discardManagedCandidate();
      await discardNpxCandidate();
      const msg = err instanceof Error ? err.message : String(err);
      const code: ProviderLifecycleErrorCode =
        err instanceof ProviderLifecycleError
          ? err.code
          : controller.signal.aborted
            ? 'INSTALL_CANCELLED'
            : 'ACTIVATION_FAILED';
      if (code === 'INSTALL_CANCELLED') {
        if (!restorePreviousInstall(previous?.installError ?? null)) {
          this.deps.store.setInstallDetails(providerId, {
            state: 'not_installed',
            stage: null,
            source: null,
            installedVersion: null,
            error: null,
          });
        }
        const cancelledRow = this.deps.store.get(providerId);
        if (!cancelledRow) throw err;
        return new Provider(cancelledRow).toDiscovery();
      }
      if (!restorePreviousInstall(`${code}: ${msg}`)) {
        this.deps.store.setInstallDetails(providerId, {
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
        this.installProgress.delete(providerId);
      }
      this.deps.onStateChange();
    }
  }

  cancelInstall(providerId: string): void {
    this.installControllers.get(providerId)?.abort(new Error('Install cancelled'));
    const agent = this.deps.getAgent(providerId);
    this.deps.launcher.invalidateProbe(providerId, this.deps.runtime, agent);
  }

  autoUpdateInstalledProviders(
    install: (id: string, options: ProviderInstallOptions) => Promise<ProviderDiscovery> = (
      id,
      options,
    ) => this.install(id, options),
  ): Promise<void> {
    return new ProviderUpdates({ store: this.deps.store, logger: this.deps.logger, install }).run();
  }

  dispose(): void {
    for (const controller of this.installControllers.values())
      controller.abort(new Error('Application shutting down'));
    this.installControllers.clear();
    this.installProgress.clear();
  }
}
