import type { ProviderDiscovery, RegistryAgent } from '@agentctl/shared';
import type { Logger } from '../../logger.js';
import type { AgentDriver } from '../../agent/types.js';
import { isAgentAuthenticationRequiredError } from '../../agent/errors.js';
import type { ProviderData } from '../provider.js';
import type { ProviderStore } from './provider-store.js';
import type { RegistryFetcher } from './registry-fetcher.js';
import type { ProviderLauncher } from './provider-launcher.js';
import { parseRegistryAgents } from './registry-parser.js';

export class ProviderProbingService {
  constructor(
    private store: ProviderStore,
    private fetcher: RegistryFetcher,
    private launcher: ProviderLauncher,
    private runtime: AgentDriver,
    private logger: Logger,
  ) {}

  async probeWithStatePreserved(
    providerId: string,
    agent: RegistryAgent,
    previousAuthState: ProviderData['authState'],
    action: string,
  ): Promise<void> {
    const row = this.store.get(providerId);
    if (row && row.installState === 'not_installed') {
      return;
    }
    try {
      await this.launcher.probe(providerId, this.runtime, agent);
    } catch (cause) {
      if (isAgentAuthenticationRequiredError(cause)) {
        if (previousAuthState !== 'authenticated') {
          this.store.setAuthState(providerId, 'required');
        }
        return;
      }
      const detail = cause instanceof Error ? cause.message : String(cause);
      if (this.store.get(providerId)) {
        const restoredAuthState =
          previousAuthState === 'authenticated' ||
          previousAuthState === 'error' ||
          previousAuthState === 'required' ||
          previousAuthState === 'unknown'
            ? previousAuthState
            : 'unknown';
        this.store.setAuthDetails(providerId, {
          authState: restoredAuthState,
          connectionState: 'error',
          authError: JSON.stringify({
            code: 'CONNECTION_FAILED',
            message: detail,
            retryable: true,
          }),
        });
      }
      throw new Error(`Failed to ${action} provider ${providerId}: ${detail}`, { cause });
    }
  }

  async probeAllInstalledProviders(
    refreshProviderFn?: (id: string) => Promise<unknown>,
  ): Promise<void> {
    const allProviders = this.store.list();
    const candidates = allProviders.filter((row) => row.installState !== 'not_installed');

    const snapshot = this.fetcher.getSnapshot();
    const agents = snapshot ? parseRegistryAgents(snapshot.data) : [];

    await Promise.allSettled(
      candidates.map(async (row) => {
        try {
          const agent = agents.find((a) => a.id === row.id);
          if (agent) {
            await this.probeWithStatePreserved(row.id, agent, row.authState, 'startup-probe');
          } else if (refreshProviderFn) {
            await refreshProviderFn(row.id);
          }
        } catch (err) {
          this.logger.warn(
            { err, providerId: row.id },
            'Background startup probe failed for provider',
          );
        }
      }),
    );
  }

  probeAgent(
    agent: RegistryAgent,
    launch: { command: string; args: string[]; env: Record<string, string> },
    _options?: object,
    _existing?: ProviderData,
  ): ProviderDiscovery {
    const dummyStore: ProviderData = {
      id: agent.id,
      name: agent.name,
      installState: 'system_available',
      installSource: 'system',
      installError: null,
      authState: 'unknown',
      enabled: true,
      hidden: false,
      distribution: '{}',
      command: launch.command,
      launchArgs: JSON.stringify(launch.args),
      launchEnv: JSON.stringify(launch.env),
      configOptions: '[]',
      authMethods: '[]',
      version: agent.version,
      description: agent.description,
      icon: agent.icon ?? null,
      customEnv: '{}',
      connectionState: 'unknown',
      authError: null,
      lastVerifiedAt: null,
      supportsDynamicModel: agent.supportsDynamicModel ?? false,
      supportsDynamicConfig: agent.supportsDynamicConfig ?? false,
      supportsLogout: agent.supportsLogout ?? false,
      nativelyLoadsSkills: false,
      modes: '[]',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const launchResolved = this.launcher.resolveLaunch(dummyStore, agent);
    const authMethods = agent.authMethods ?? [];
    return {
      id: agent.id,
      label: agent.name,
      command: launchResolved.command,
      launchArgs: launchResolved.args,
      launchEnv: launchResolved.env,
      customEnv: {},
      customEnvConfigured: {},
      configOptions: agent.configOptions ?? [],
      authMethods,
      version: agent.version,
      description: agent.description,
      icon: agent.icon,
      supportsDynamicModel: agent.supportsDynamicModel ?? false,
      supportsDynamicConfig: agent.supportsDynamicConfig ?? false,
      supportsLogout: agent.supportsLogout ?? false,
      nativelyLoadsSkills: false,
      installState: 'system_available',
      installSource: 'system',
      installedVersion: null,
      availableVersion: agent.version,
      updateAvailable: false,
      connectionState: 'unknown',
      authState: 'unknown',
      authError: null,
      lastVerifiedAt: null,
      status: 'inactive',
      enabled: true,
      agent,
    };
  }
}
