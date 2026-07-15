import type { RegistryFetcher } from './registry-fetcher.js';
import type { ProviderStore } from './provider-store.js';
import type { BinaryInstaller } from './binary-installer.js';
import type { ProviderLauncher } from './provider-launcher.js';

export class ProviderSync {
  constructor(
    private fetcher: RegistryFetcher,
    private store: ProviderStore,
    private installer: BinaryInstaller,
    private launcher: ProviderLauncher,
  ) {}

  async sync(): Promise<void> {
    const registryAgents = await this.fetcher.fetch();
    const registryIds = new Set(registryAgents.map((a) => a.id));

    const pathChecks: Promise<void>[] = [];

    for (const agent of registryAgents) {
      const existing = this.store.get(agent.id);

      if (!existing) {
        const command = agent.distribution.npx ? 'npx' : agent.distribution.uvx ? 'uvx' : agent.id;
        this.store.upsert(agent.id, {
          name: agent.name,
          version: agent.version,
          description: agent.description,
          icon: agent.icon,
          command,
          launchArgs: '[]',
          launchEnv: '{}',
          configOptions: JSON.stringify(agent.configOptions ?? []),
          authMethods: JSON.stringify(agent.authMethods ?? []),
          supportsDynamicModel: !!agent.supportsDynamicModel,
          supportsDynamicConfig: !!agent.supportsDynamicConfig,
          supportsLogout: !!agent.supportsLogout,
          distribution: JSON.stringify(agent.distribution),
          installState: 'not_installed',
          authState: 'unknown',
          enabled: true,
          hidden: false,
        });
        continue;
      }

      let installState = existing.installState;
      let authState = existing.authState;

      if (installState === 'installed_local') {
        if (!this.installer.isInstalled(agent.id)) {
          installState = 'not_installed';
          authState = 'unknown';
        }
      } else if (installState === 'system_available' || installState === 'installed') {
        installState = 'system_available';
        const command = agent.distribution.npx ? 'npx' : agent.distribution.uvx ? 'uvx' : agent.id;
        pathChecks.push(
          this.launcher.isBinaryOnPath(command).then((onPath) => {
            if (!onPath) {
              this.store.setInstallState(agent.id, 'not_installed');
              this.store.setAuthState(agent.id, 'unknown');
            }
          }),
        );
      }

      this.store.upsert(agent.id, {
        name: agent.name,
        version: agent.version,
        description: agent.description,
        icon: agent.icon,
        configOptions: JSON.stringify(agent.configOptions ?? []),
        authMethods: JSON.stringify(agent.authMethods ?? []),
        supportsDynamicModel: !!agent.supportsDynamicModel,
        supportsDynamicConfig: !!agent.supportsDynamicConfig,
        supportsLogout: !!agent.supportsLogout,
        nativelyLoadsSkills: existing.nativelyLoadsSkills,
        distribution: JSON.stringify(agent.distribution),
        installState,
        authState,
      });
    }

    await Promise.all(pathChecks);

    const currentRows = this.store.listAll();
    for (const row of currentRows) {
      if (!registryIds.has(row.id)) {
        if (row.installState === 'installed_local' || row.installState === 'system_available') {
          this.store.update(row.id, {
            installState: 'not_installed',
            authState: 'unknown',
            hidden: true,
          });
        } else {
          this.store.hide(row.id);
        }
      }
    }

    const defaultId = this.store.getDefaultProviderId();
    if (defaultId) {
      const defaultProv = this.store.get(defaultId);
      if (!defaultProv || defaultProv.hidden || defaultProv.installState === 'not_installed') {
        const firstInstalled = this.store.list().find((p) => p.installState !== 'not_installed');
        this.store.setDefaultProviderId(firstInstalled?.id ?? '');
      }
    }
  }
}
