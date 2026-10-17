import { registryProviderMetadata, providerDataFromRegistry } from './provider-data.js';
import type { RegistryAgent } from '@agentctl/shared';
import { getPlatformKey } from './binary-installer.js';
import type { ProviderLauncher } from './provider-launcher.js';
import type { ProviderStore } from './provider-store.js';
import type { RegistryFetcher } from './registry-fetcher.js';
import { jsonCodecs } from '../../db/json-codecs.js';

export class ProviderSync {
  constructor(
    private fetcher: RegistryFetcher,
    private store: ProviderStore,
    private launcher: ProviderLauncher,
  ) {}

  async sync(): Promise<void> {
    let agents: RegistryAgent[];
    try {
      agents = await this.fetcher.fetch();
      this.store.deleteSetting('registrySyncError');
    } catch (err: unknown) {
      if (this.fetcher.isDisposed) throw err;
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
        ? this.launcher.resolveBaseLaunch(existing, agent)
        : { command: providerDataFromRegistry(agent).command, args: [], env: {} };

      const metadata = registryProviderMetadata(agent);
      let {
        configOptions,
        authMethods,
        supportsDynamicModel,
        supportsDynamicConfig,
        supportsLogout,
      } = metadata;

      // Installed providers may contain richer capabilities discovered from an
      // ACP handshake. Available/uninstalled providers should mirror the current
      // registry instead of retaining stale metadata forever.
      if (existing && isInstalled) {
        const existingOpts = jsonCodecs.agentConfigOptions(existing.configOptions);
        if (existingOpts.length > 0) {
          configOptions = existing.configOptions;
        }
        const existingAuth = jsonCodecs.authMethods(existing.authMethods);
        if (existingAuth.length > 0) {
          authMethods = existing.authMethods;
        }
        supportsDynamicModel =
          existing.supportsDynamicModel || (agent.supportsDynamicModel ?? false);
        supportsDynamicConfig =
          existing.supportsDynamicConfig || (agent.supportsDynamicConfig ?? false);
        supportsLogout = existing.supportsLogout || (agent.supportsLogout ?? false);
      }

      let installState =
        existing?.installState ?? (isInstalled ? 'system_available' : 'not_installed');
      let finalCommand = launchResolved.command;
      let finalArgs = launchResolved.args;
      let installSource = existing?.installSource ?? null;

      if (!existing || existing.installState === 'not_installed') {
        const detected = await this.launcher.detectSystemBinary(agent, getPlatformKey());
        if (detected) {
          installState = 'system_available';
          installSource = 'system';
          finalCommand = detected.command;
          finalArgs = detected.args ?? [];
        }
      }

      this.store.upsert(agent.id, {
        ...metadata,
        command: finalCommand,
        launchArgs: JSON.stringify(finalArgs),
        launchEnv: JSON.stringify(launchResolved.env),
        configOptions,
        authMethods,
        installState,
        installSource,
        installError: existing?.installError ?? null,
        authState:
          existing?.authState === 'needs_auth' ? 'required' : (existing?.authState ?? 'unknown'),
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
