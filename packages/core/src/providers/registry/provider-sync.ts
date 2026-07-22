import type { RegistryAgent } from '@agentctl/shared';
import type { BinaryInstaller } from './binary-installer.js';
import type { ProviderLauncher } from './provider-launcher.js';
import type { ProviderStore } from './provider-store.js';
import type { RegistryFetcher } from './registry-fetcher.js';

export class ProviderSync {
  constructor(
    private fetcher: RegistryFetcher,
    private store: ProviderStore,
    private installer: BinaryInstaller,
    private launcher: ProviderLauncher,
  ) {}

  async sync(): Promise<void> {
    let agents: RegistryAgent[];
    try {
      agents = await this.fetcher.fetch();
      this.store.deleteSetting('registrySyncError');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.store.updateSetting('registrySyncError', msg);
      throw err;
    }

    const currentRows = this.store.listAll();
    const currentMap = new Map(currentRows.map((r) => [r.id, r]));

    for (const agent of agents) {
      const existing = currentMap.get(agent.id);
      const isInstalled = existing ? existing.installState !== 'not_installed' : false;

      const launchResolved = existing
        ? this.launcher.resolveLaunch(existing, agent)
        : {
            command: agent.distribution.npx ? 'npx' : agent.distribution.uvx ? 'uvx' : agent.id,
            args: [],
            env: {},
          };

      this.store.upsert(agent.id, {
        name: agent.name,
        version: agent.version,
        description: agent.description,
        icon: agent.icon ?? null,
        command: launchResolved.command,
        launchArgs: JSON.stringify(launchResolved.args),
        launchEnv: JSON.stringify(launchResolved.env),
        configOptions: JSON.stringify(agent.configOptions ?? []),
        authMethods: JSON.stringify(agent.authMethods ?? []),
        installState:
          existing?.installState ?? (isInstalled ? 'system_available' : 'not_installed'),
        authState:
          existing?.authState ?? ((agent.authMethods ?? []).length ? 'unknown' : 'authenticated'),
        supportsDynamicModel: agent.supportsDynamicModel ?? false,
        supportsDynamicConfig: agent.supportsDynamicConfig ?? false,
        supportsLogout: agent.supportsLogout ?? false,
      });
    }

    // Update default provider if not set
    const currentDefault = this.store.getDefaultProviderId();
    if (!currentDefault) {
      const installed = this.store
        .list()
        .find((p) => p.enabled && p.installState !== 'not_installed');
      if (installed) {
        this.store.setDefaultProviderId(installed.id);
      }
    }
  }
}
