import type { CredentialStore } from '../../security/credential-store.js';
import { Provider, type ProviderData } from '../provider.js';
import type { ProviderStore } from './provider-store.js';
import type { RegistryFetcher } from './registry-fetcher.js';
import { providerDataFromRegistry } from './provider-data.js';
import type { RegistryAgent, ProviderDiscovery } from '@agentctl/shared';

interface Dependencies {
  credentials: Pick<CredentialStore, 'resolveEnvSync'>;
  store: Pick<ProviderStore, 'get' | 'list' | 'getSetting'>;
  fetcher: Pick<RegistryFetcher, 'getCachedAgents'>;
  withInstallProgress: (discovery: ProviderDiscovery) => ProviderDiscovery;
}

export class ProviderQueries {
  constructor(private readonly deps: Dependencies) {}

  getAgent(providerId: string, fallback?: ProviderData): RegistryAgent | undefined {
    const registryId = (fallback ?? this.deps.store.get(providerId))?.registryAgentId ?? providerId;
    const agent = this.deps.fetcher
      .getCachedAgents()
      ?.find((candidate) => candidate.id === registryId);
    if (agent) return agent;
    const row = fallback ?? this.deps.store.get(providerId);
    return row ? new Provider(row, this.deps.credentials).toDiscovery().agent : undefined;
  }

  async discover(): Promise<ProviderDiscovery[]> {
    return this.deps.store
      .list()
      .map((row) =>
        this.deps.withInstallProgress(new Provider(row, this.deps.credentials).toDiscovery()),
      );
  }

  async catalog(): Promise<ProviderDiscovery[]> {
    // Catalog reads must not fetch, sync, or probe. Startup and explicit Sync All
    // update the cache and publish the resulting provider state change.
    const agents = this.deps.fetcher.getCachedAgents();
    if (!agents) {
      return this.deps.store
        .list()
        .map((row) =>
          this.deps.withInstallProgress(new Provider(row, this.deps.credentials).toDiscovery()),
        );
    }

    return agents.map((agent) => {
      const row = this.deps.store.get(agent.id);
      let discovery: ProviderDiscovery;
      if (row) {
        discovery = new Provider(row, this.deps.credentials).toDiscovery();
      } else {
        const synthetic = providerDataFromRegistry(agent);
        discovery = new Provider(synthetic).toDiscovery();
      }

      if (discovery.agent) {
        discovery.agent = {
          ...discovery.agent,
          repository: agent.repository,
          website: agent.website,
        };
      }

      return this.deps.withInstallProgress(discovery);
    });
  }

  getProvider(id: string): Provider | undefined {
    const row = this.deps.store.get(id);
    return row ? new Provider(row, this.deps.credentials) : undefined;
  }

  getSettings(): Record<string, string | undefined> {
    const keys = [
      'onboardingCompleted',
      'onboardingVersion',
      'setupStep',
      'defaultProviderId',
      'gitTextGeneration',
      'showThinking',
      'defaultToWorktree',
      'registrySyncError',
      'fontConfig',
    ];
    const settings: Record<string, string | undefined> = {};
    for (const key of keys) {
      const val = this.deps.store.getSetting(key);
      if (val !== undefined) settings[key] = val;
    }
    return settings;
  }
}
