import type { AgentDriver } from '../../agent/types.js';
import type { AgentConnectionLifecycle } from '../../agent/connection-lifecycle.js';
import type { Logger } from '../../logger.js';
import { Provider, type ProviderData } from '../provider.js';
import type { ProviderStore } from './provider-store.js';
import type { ProviderLauncher } from './provider-launcher.js';
import type { ProviderAuthCoordinator } from './provider-auth-coordinator.js';
import type { RegistryAgent, ProviderDiscovery } from '@agentctl/shared';
import { randomUUID } from 'node:crypto';
import { customModelsSchema, type CustomModel, type AgentConfigOption } from '@agentctl/shared';
import { jsonCodecs } from '../../db/json-codecs.js';
import { defaultCredentialVault } from '../../security/credential-vault.js';
import type { ProviderOperationCoordinator } from './provider-operation-coordinator.js';

interface Dependencies {
  store: Pick<
    ProviderStore,
    | 'get'
    | 'upsert'
    | 'update'
    | 'getDefaultProviderId'
    | 'deleteSetting'
    | 'setCustomEnv'
    | 'setDefaultConfigOptions'
    | 'list'
    | 'setDefaultProviderId'
  >;
  authCoordinator: Pick<ProviderAuthCoordinator, 'cancelLogin'>;
  connectionManager: Pick<AgentConnectionLifecycle, 'closeConnection'>;
  runtime: AgentDriver;
  launcher: Pick<ProviderLauncher, 'invalidateProbe'>;
  coordinator: Pick<ProviderOperationCoordinator, 'runProviderOperation'>;
  logger: Logger;
  notifyStateChange: () => void;
  getProvider: (id: string) => Provider | undefined;
  getAgent: (id: string, fallback?: ProviderData) => RegistryAgent | undefined;
  probeWithStatePreserved: (
    id: string,
    agent: RegistryAgent,
    previousAuthState: ProviderData['authState'],
    action: string,
  ) => Promise<void>;
}

export class ProviderConfiguration {
  constructor(private readonly deps: Dependencies) {}

  async createProfile(providerId: string, name: string): Promise<ProviderDiscovery> {
    const source = this.deps.store.get(providerId);
    if (!source) throw new Error('Provider not found');
    if (!name.trim()) throw new Error('A profile name is required');
    const id = `profile-${randomUUID()}`;
    this.deps.store.upsert(id, {
      ...source,
      id,
      registryAgentId: source.registryAgentId ?? providerId,
      name: name.trim(),
      customEnv: '{}',
      authState: 'unknown',
      connectionState: 'unknown',
      authError: null,
      lastVerifiedAt: null,
      hidden: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    this.deps.notifyStateChange();
    return this.deps.getProvider(id)!.toDiscovery();
  }

  async removeProfile(providerId: string): Promise<ProviderDiscovery> {
    return this.deps.coordinator.runProviderOperation(providerId, 'remove-profile', async () => {
      const row = this.deps.store.get(providerId);
      if (!row?.registryAgentId) throw new Error('Provider is not a named profile');
      // Keep configuration for saved sessions that still use this profile.
      this.deps.authCoordinator.cancelLogin(providerId);
      this.deps.connectionManager.closeConnection(providerId);
      this.deps.store.update(providerId, { hidden: true });
      if (this.deps.store.getDefaultProviderId() === providerId)
        this.deps.store.deleteSetting('defaultProviderId');
      this.deps.notifyStateChange();
      return this.deps.getProvider(providerId)!.toDiscovery();
    });
  }

  async setProviderConfig(
    providerId: string,
    updates: {
      customEnv?: Record<string, string>;
      customModels?: CustomModel[];
      nativelyLoadsSkills?: boolean;
      defaultConfigOptions?: AgentConfigOption[];
      protocol?: 'auto' | 'v1' | 'v2';
      defaultModel?: string;
      defaultThinkingEffort?: string | null;
    },
  ): Promise<ProviderDiscovery> {
    return this.deps.coordinator.runProviderOperation(providerId, 'set-config', async () => {
      if (updates.customModels !== undefined) customModelsSchema.parse(updates.customModels);
      const rowBeforeUpdate = this.deps.store.get(providerId);
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
          this.deps.store.setCustomEnv(providerId, merged);
        } catch (error) {
          await defaultCredentialVault.restoreProviderSecrets(providerId, vaultSnapshot);
          throw error;
        }
      }
      if (updates.nativelyLoadsSkills !== undefined) {
        this.deps.store.update(providerId, { nativelyLoadsSkills: updates.nativelyLoadsSkills });
      }
      if (updates.defaultConfigOptions !== undefined) {
        this.deps.store.setDefaultConfigOptions(providerId, updates.defaultConfigOptions);
      }

      this.deps.store.update(providerId, {
        ...(updates.customModels !== undefined
          ? { customModels: JSON.stringify(updates.customModels) }
          : {}),
        ...(updates.protocol !== undefined ? { protocol: updates.protocol } : {}),
        ...(updates.defaultModel !== undefined
          ? { defaultModel: updates.defaultModel || null }
          : {}),
        ...(updates.defaultThinkingEffort !== undefined
          ? { defaultThinkingEffort: updates.defaultThinkingEffort || null }
          : {}),
      });
      if (updates.customEnv !== undefined || updates.protocol !== undefined)
        this.deps.connectionManager.closeConnection(providerId);
      const agent = this.deps.getAgent(providerId, rowBeforeUpdate);

      this.deps.launcher.invalidateProbe(providerId, this.deps.runtime, agent);
      if (agent && rowBeforeUpdate.installState !== 'not_installed') {
        try {
          await this.deps.probeWithStatePreserved(
            providerId,
            agent,
            rowBeforeUpdate.authState,
            'apply configuration for',
          );
        } catch (err) {
          this.deps.logger.warn(
            { err, providerId },
            'Failed to probe provider after config update',
          );
        }
      }

      const row = this.deps.store.get(providerId);
      if (!row) throw new Error(`Provider ${providerId} vanished`);
      return new Provider(row).toDiscovery();
    });
  }

  setDefaultProvider(id: string | null | undefined): void {
    const normalized = id?.trim() ? id.trim() : null;
    if (normalized) {
      const exists = this.deps.store
        .list()
        .some((p) => p.id === normalized && p.enabled && p.installState !== 'not_installed');
      if (!exists) {
        throw new Error(
          `Cannot set default provider: ${normalized} is not an enabled, installed provider`,
        );
      }
    }
    if (normalized) {
      this.deps.store.setDefaultProviderId(normalized);
    } else {
      this.deps.store.deleteSetting('defaultProviderId');
    }
  }
}
