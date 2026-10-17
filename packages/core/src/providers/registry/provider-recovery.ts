import path from 'node:path';
import type { ProviderStore } from './provider-store.js';
import type { RegistryFetcher } from './registry-fetcher.js';
import { getPlatformKey, type BinaryInstaller } from './binary-installer.js';
import type { Logger } from '../../logger.js';

interface Dependencies {
  store: Pick<ProviderStore, 'listAll' | 'update' | 'setInstallDetails' | 'setAuthDetails'>;
  fetcher: Pick<RegistryFetcher, 'getCachedAgents'>;
  installer: Pick<BinaryInstaller, 'removeStaleStaging' | 'isInstalled' | 'getVersionedInstallDir'>;
  logger: Logger;
  notifyStateChange: () => void;
}

export class ProviderRecovery {
  constructor(private readonly deps: Dependencies) {}

  async recoverInterruptedOperations(): Promise<void> {
    const agents = this.deps.fetcher.getCachedAgents() ?? [];
    let changed = false;

    await this.deps.installer.removeStaleStaging(this.deps.logger).catch((error: unknown) => {
      this.deps.logger.warn({ error }, 'Failed to clean orphaned provider staging directories');
    });

    for (const row of this.deps.store.listAll()) {
      const agent = agents.find((candidate) => candidate.id === row.id);
      if (row.installState === 'installing') {
        const hasPreviousInstall =
          !!row.installedVersion ||
          row.installSource === 'system' ||
          row.installSource === 'npx' ||
          row.installSource === 'uvx';
        const hasCurrentManagedInstall = !!agent && this.deps.installer.isInstalled(row.id, agent);
        const interruptedError =
          'INSTALL_INTERRUPTED: Installation was interrupted by application shutdown';

        if (!hasPreviousInstall && hasCurrentManagedInstall && agent) {
          const target = agent.distribution.binary?.[getPlatformKey()];
          if (target) {
            const versionedDir = this.deps.installer.getVersionedInstallDir(
              agent.id,
              agent.version,
              target.archive,
            );
            this.deps.store.update(row.id, {
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
          this.deps.store.setInstallDetails(row.id, {
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
        this.deps.store.setInstallDetails(row.id, {
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
        this.deps.store.setAuthDetails(row.id, {
          authState: 'required',
          connectionState: 'unknown',
          authError: JSON.stringify(authError),
        });
        changed = true;
      } else if (row.connectionState === 'checking') {
        this.deps.store.setAuthDetails(row.id, { connectionState: 'unknown' });
        changed = true;
      }
    }

    if (changed) this.deps.notifyStateChange();
  }
}
