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

      let configOptions = JSON.stringify(agent.configOptions ?? []);
      let authMethods = JSON.stringify(agent.authMethods ?? []);
      let supportsDynamicModel = agent.supportsDynamicModel ?? false;
      let supportsDynamicConfig = agent.supportsDynamicConfig ?? false;
      let supportsLogout = agent.supportsLogout ?? false;

      if (existing) {
        try {
          const existingOpts = existing.configOptions
            ? (JSON.parse(existing.configOptions) as unknown[])
            : [];
          if (Array.isArray(existingOpts) && existingOpts.length > 0) {
            configOptions = existing.configOptions;
          }
        } catch {
          // ignore
        }
        try {
          const existingAuth = existing.authMethods
            ? (JSON.parse(existing.authMethods) as unknown[])
            : [];
          if (Array.isArray(existingAuth) && existingAuth.length > 0) {
            authMethods = existing.authMethods;
          }
        } catch {
          // ignore
        }
        supportsDynamicModel =
          existing.supportsDynamicModel || (agent.supportsDynamicModel ?? false);
        supportsDynamicConfig =
          existing.supportsDynamicConfig || (agent.supportsDynamicConfig ?? false);
        supportsLogout = existing.supportsLogout || (agent.supportsLogout ?? false);
      }

      this.store.upsert(agent.id, {
        name: agent.name,
        version: agent.version,
        description: agent.description,
        icon: agent.icon ?? null,
        command: launchResolved.command,
        launchArgs: JSON.stringify(launchResolved.args),
        launchEnv: JSON.stringify(launchResolved.env),
        configOptions,
        authMethods,
        installState:
          existing?.installState ?? (isInstalled ? 'system_available' : 'not_installed'),
        authState:
          existing?.authState ?? ((agent.authMethods ?? []).length ? 'unknown' : 'authenticated'),
        supportsDynamicModel,
        supportsDynamicConfig,
        supportsLogout,
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
