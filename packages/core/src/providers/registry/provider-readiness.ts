import type { CredentialStore } from '../../security/credential-store.js';
import type { AgentDriver } from '../../agent/types.js';
import { Provider, type ProviderData } from '../provider.js';
import type { ProviderStore } from './provider-store.js';
import type { ProviderLauncher } from './provider-launcher.js';
import type { ProviderAuthCoordinator } from './provider-auth-coordinator.js';
import type { RegistryAgent, ProviderDiscovery } from '@agentctl/shared';
import { findAgentConfigOption } from '@agentctl/shared';
import { jsonCodecs } from '../../db/json-codecs.js';

interface Dependencies {
  credentials: Pick<CredentialStore, 'resolveEnvSync'>;
  store: Pick<ProviderStore, 'get'>;
  authCoordinator: Pick<ProviderAuthCoordinator, 'waitForCredentialOperation'>;
  launcher: Pick<ProviderLauncher, 'invalidateProbe' | 'resolveLaunch' | 'prepareLaunch'>;
  runtime: AgentDriver;
  sync: () => Promise<void>;
  install: (id: string) => Promise<ProviderDiscovery>;
  getAgent: (id: string, fallback?: ProviderData) => RegistryAgent | undefined;
  probeWithStatePreserved: (
    id: string,
    agent: RegistryAgent,
    previousAuthState: ProviderData['authState'],
    action: string,
  ) => Promise<void>;
}

export class ProviderReadiness {
  constructor(private readonly deps: Dependencies) {}

  async ensureProviderReady(
    providerId: string,
    options: { force?: boolean } = {},
  ): Promise<Provider> {
    await this.deps.authCoordinator.waitForCredentialOperation(providerId);
    let row = this.deps.store.get(providerId);
    if (!row) {
      await this.deps.sync();
      row = this.deps.store.get(providerId);
    }
    if (!row) throw new Error(`Provider ${providerId} not found`);

    const agent = this.deps.getAgent(providerId, row);

    if (row.installState === 'not_installed') {
      await this.deps.install(providerId);
      const updated = this.deps.store.get(providerId);
      if (!updated) throw new Error(`Provider ${providerId} vanished after install`);
      return new Provider(updated, this.deps.credentials);
    }

    await this.deps.launcher.prepareLaunch(
      providerId,
      this.deps.launcher.resolveLaunch(row, agent),
    );
    row = this.deps.store.get(providerId) ?? row;

    if (!options.force && row.authState === 'required') {
      return new Provider(row, this.deps.credentials);
    }

    if (!options.force && row.authState === 'not_required' && row.connectionState === 'ready') {
      return new Provider(row, this.deps.credentials);
    }

    if (!options.force && row.authState === 'authenticated' && row.connectionState === 'ready') {
      const opts = jsonCodecs.agentConfigOptions(row.configOptions);
      const hasModelConfig = !!findAgentConfigOption(opts, 'model');
      const recentlyVerified =
        !!row.lastVerifiedAt && Date.now() - row.lastVerifiedAt.getTime() < 5 * 60_000;
      if (hasModelConfig || recentlyVerified) {
        return new Provider(row, this.deps.credentials);
      }
    }

    if (agent) {
      this.deps.launcher.invalidateProbe(providerId, this.deps.runtime, agent);
      await this.deps.probeWithStatePreserved(providerId, agent, row.authState, 'prepare');
    }

    const updated = this.deps.store.get(providerId);
    if (!updated) throw new Error(`Provider ${providerId} vanished after probe`);
    return new Provider(updated, this.deps.credentials);
  }

  async listNativeSessions(providerId: string, cwd: string, cursor?: string) {
    const provider = await this.ensureProviderReady(providerId);
    if (!provider.features.sessions.list || !this.deps.runtime.listSessions)
      throw new Error('Agent does not support native session listing');
    const launch = this.deps.launcher.resolveLaunch(
      this.deps.store.get(providerId)!,
      this.deps.getAgent(providerId),
    );
    return this.deps.runtime.listSessions(launch.command, launch.args, launch.env, { cwd, cursor });
  }
}
