import type { RegistryAgent } from '@agentctl/shared';
import type { ProviderData } from '../provider.js';

/** Registry metadata is replaced independently of installation and credential state. */
export function registryProviderMetadata(agent: RegistryAgent) {
  return {
    name: agent.name,
    version: agent.version,
    description: agent.description,
    icon: agent.icon ?? null,
    distribution: JSON.stringify(agent.distribution),
    configOptions: JSON.stringify(agent.configOptions ?? []),
    authMethods: JSON.stringify(agent.authMethods ?? []),
    supportsDynamicModel: agent.supportsDynamicModel ?? false,
    supportsDynamicConfig: agent.supportsDynamicConfig ?? false,
    supportsLogout: agent.supportsLogout ?? false,
  };
}

export function createProviderData(
  values: Pick<ProviderData, 'id' | 'name'> & Partial<ProviderData>,
): ProviderData {
  const now = new Date();
  return {
    command: values.id,
    installState: 'not_installed',
    installError: null,
    authState: 'unknown',
    connectionState: 'unknown',
    authError: null,
    lastVerifiedAt: null,
    enabled: true,
    hidden: false,
    distribution: '{}',
    launchArgs: '[]',
    launchEnv: '{}',
    configOptions: '[]',
    authMethods: '[]',
    version: null,
    description: null,
    icon: null,
    customEnv: '{}',
    supportsDynamicModel: false,
    supportsDynamicConfig: false,
    supportsLogout: false,
    nativelyLoadsSkills: false,
    modes: '[]',
    createdAt: now,
    updatedAt: now,
    ...values,
  };
}

export function providerDataFromRegistry(
  agent: RegistryAgent,
  overrides: Partial<ProviderData> = {},
): ProviderData {
  return createProviderData({
    id: agent.id,
    command: agent.distribution.npx ? 'npx' : agent.distribution.uvx ? 'uvx' : agent.id,
    ...registryProviderMetadata(agent),
    ...overrides,
  });
}
