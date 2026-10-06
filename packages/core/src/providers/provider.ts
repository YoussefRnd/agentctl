import {
  findAgentConfigOption,
  withCustomModels,
  decodeCustomModels,
  type AgentConfigOption,
  type AuthState,
  type ConnectionState,
  type InstallSource,
  type InstallStage,
  type ProviderDiscovery,
  type ProviderStatus,
  type ThinkingEffort,
  type RegistryAgent,
} from '@agentctl/shared';
import type { providers } from '../db/schema.js';
import { DEFAULT_AGENT_MODEL, DEFAULT_THINKING_EFFORT } from '../config/runtime-defaults.js';
import { jsonCodecs } from '../db/json-codecs.js';
import { defaultCredentialVault } from '../security/credential-vault.js';

export type ProviderData = Omit<
  typeof providers.$inferSelect,
  | 'registryAgentId'
  | 'customModels'
  | 'protocol'
  | 'defaultModel'
  | 'defaultThinkingEffort'
  | 'features'
  | 'capabilitySnapshot'
  | 'authError'
  | 'lastVerifiedAt'
  | 'connectionState'
  | 'authState'
  | 'installStage'
  | 'installSource'
  | 'installedVersion'
> & {
  customModels?: string;
  registryAgentId?: string | null;
  protocol?: 'auto' | 'v1' | 'v2';
  defaultModel?: string | null;
  defaultThinkingEffort?: string | null;
  features?: string;
  capabilitySnapshot?: string | null;
  authError?: string | null;
  lastVerifiedAt?: Date | null;
  connectionState?: ConnectionState;
  authState: AuthState | 'needs_auth';
  installStage?: InstallStage | null;
  installSource?: InstallSource | null;
  installedVersion?: string | null;
};

export interface ProviderLaunchConfig {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export class Provider {
  constructor(private readonly data: ProviderData) {}

  get id(): string {
    return this.data.id;
  }

  get installState(): string {
    return this.data.installState;
  }

  get installError(): string | null {
    return this.data.installError ?? null;
  }

  get authState(): string {
    return this.data.authState;
  }

  get isInstalled(): boolean {
    return (
      this.data.installState === 'installed_local' || this.data.installState === 'system_available'
    );
  }

  get isReady(): boolean {
    return (
      this.isInstalled &&
      this.data.connectionState !== 'error' &&
      (this.data.authState === 'authenticated' || this.data.authState === 'not_required')
    );
  }

  get needsAuth(): boolean {
    return (
      this.isInstalled &&
      (this.data.authState === 'required' || this.data.authState === 'needs_auth')
    );
  }

  get hasError(): boolean {
    return (
      this.data.connectionState === 'error' ||
      this.data.authState === 'error' ||
      this.data.installState === 'failed'
    );
  }

  get status(): ProviderStatus {
    if (!this.data.enabled) return 'inactive';
    if (this.data.installState === 'failed') return 'error';
    if (this.data.installState === 'installing') return 'inactive';
    if (this.data.installState === 'not_installed') return 'not_found';
    if (this.data.connectionState === 'error') return 'error';
    if (this.data.authState === 'required' || this.data.authState === 'needs_auth')
      return 'needs_auth';
    if (this.data.authState === 'error') return 'error';
    if (
      this.data.authState === 'unknown' ||
      this.data.authState === 'authenticating' ||
      this.data.authState === 'verifying'
    ) {
      return 'inactive';
    }
    return 'ready';
  }

  get supportsDynamicModel(): boolean {
    return this.data.supportsDynamicModel;
  }

  get supportsDynamicConfig(): boolean {
    return this.data.supportsDynamicConfig;
  }

  get supportsLogout(): boolean {
    return this.data.supportsLogout;
  }

  get features() {
    const persisted = jsonCodecs.agentFeatures(this.data.features);
    return {
      ...persisted,
      configuration: {
        model: persisted.configuration.model || this.supportsDynamicModel,
        options: persisted.configuration.options || this.supportsDynamicConfig,
      },
      authentication: {
        logout: persisted.authentication.logout || this.supportsLogout,
      },
    };
  }

  get capabilitySnapshot() {
    return jsonCodecs.capabilitySnapshot(this.data.capabilitySnapshot);
  }

  getLaunchConfig(selectedModel: string, selectedThinkingEffort: string): ProviderLaunchConfig {
    const extraArgs: string[] = [];
    const configOptions = this.parseConfigOptions();
    const features = this.features;

    const hasModelOption = !!findAgentConfigOption(configOptions, 'model');
    const hasThinkingOption = !!findAgentConfigOption(configOptions, 'thought_level');

    if (
      !features.configuration.model &&
      hasModelOption &&
      selectedModel &&
      selectedModel !== DEFAULT_AGENT_MODEL &&
      !features.configuration.options
    ) {
      extraArgs.push('--model', selectedModel);
    }

    if (!features.configuration.options && hasThinkingOption && selectedThinkingEffort) {
      extraArgs.push('--thinking-effort', selectedThinkingEffort);
    }

    return {
      command: this.data.command,
      args: [...jsonCodecs.stringArray(this.data.launchArgs), ...extraArgs],
      env: {
        ...jsonCodecs.stringRecord(this.data.launchEnv),
        ...defaultCredentialVault.resolveEnvSync(jsonCodecs.stringRecord(this.data.customEnv)),
        ...(this.data.protocol && this.data.protocol !== 'auto'
          ? { AGENTCTL_ACP_PROTOCOL: this.data.protocol }
          : {}),
      },
    };
  }

  resolveDefaultSelection(): {
    selectedModel: string;
    selectedThinkingEffort: ThinkingEffort;
  } {
    const configOptions = this.parseConfigOptions();
    const modelOption = findAgentConfigOption(configOptions, 'model');
    const thinkingOption = findAgentConfigOption(configOptions, 'thought_level');

    return {
      selectedModel:
        this.data.defaultModel ??
        (typeof modelOption?.currentValue === 'string'
          ? modelOption.currentValue
          : modelOption?.options?.[0]?.value) ??
        DEFAULT_AGENT_MODEL,
      selectedThinkingEffort: (this.data.defaultThinkingEffort ??
        thinkingOption?.currentValue ??
        thinkingOption?.options?.[0]?.value ??
        DEFAULT_THINKING_EFFORT) as ThinkingEffort,
    };
  }

  private buildAgent(): RegistryAgent {
    return {
      id: this.data.registryAgentId ?? this.data.id,
      name: this.data.name,
      version: this.data.version ?? '',
      description: this.data.description ?? '',
      authors: [],
      distribution: jsonCodecs.registryDistribution(this.data.distribution),
      icon: this.data.icon ?? undefined,
      configOptions: this.parseConfigOptions(),
      authMethods: jsonCodecs.authMethods(this.data.authMethods),
      supportsDynamicModel: this.data.supportsDynamicModel,
      supportsDynamicConfig: this.data.supportsDynamicConfig,
      supportsLogout: this.data.supportsLogout,
      features: this.features,
    };
  }

  toDiscovery(): ProviderDiscovery {
    const rawCustomEnv = jsonCodecs.stringRecord(this.data.customEnv);
    const customEnvConfigured: Record<string, boolean> = {};
    const redactedCustomEnv: Record<string, string> = {};

    for (const [key, value] of Object.entries(rawCustomEnv)) {
      customEnvConfigured[key] = value !== '';
      redactedCustomEnv[key] = '';
    }

    return {
      id: this.data.id,
      label: this.data.name,
      registryAgentId: this.data.registryAgentId ?? this.data.id,
      isProfile: !!this.data.registryAgentId,
      protocol: this.data.protocol ?? 'auto',
      customModels: decodeCustomModels(this.data.customModels),
      defaultModel: this.data.defaultModel ?? undefined,
      defaultThinkingEffort: this.data.defaultThinkingEffort ?? undefined,
      command: this.data.command,
      launchArgs: jsonCodecs.stringArray(this.data.launchArgs),
      launchEnv: jsonCodecs.stringRecord(this.data.launchEnv),
      customEnv: redactedCustomEnv,
      customEnvConfigured,
      configOptions: this.parseConfigOptions(),
      authMethods: jsonCodecs.authMethods(this.data.authMethods),
      version: this.data.version ?? undefined,
      description: this.data.description ?? undefined,
      icon: this.data.icon ?? undefined,
      supportsDynamicModel: this.data.supportsDynamicModel,
      supportsDynamicConfig: this.data.supportsDynamicConfig,
      supportsLogout: this.data.supportsLogout,
      features: this.features,
      snapshot: this.capabilitySnapshot,
      nativelyLoadsSkills: this.data.nativelyLoadsSkills,
      installState: this.data.installState as ProviderDiscovery['installState'],
      installError: this.data.installError ?? null,
      installStage: this.data.installStage ?? null,
      installSource: this.data.installSource ?? null,
      installedVersion: this.data.installedVersion ?? null,
      availableVersion: this.data.version ?? undefined,
      updateAvailable:
        !!this.data.installedVersion &&
        !!this.data.version &&
        this.data.installedVersion !== this.data.version,
      connectionState: (this.data.connectionState ??
        'unknown') as ProviderDiscovery['connectionState'],
      authState: (this.data.authState === 'needs_auth'
        ? 'required'
        : this.data.authState) as ProviderDiscovery['authState'],
      authError: jsonCodecs.authError(this.data.authError),
      lastVerifiedAt: this.data.lastVerifiedAt ?? null,
      status: this.status,
      enabled: this.data.enabled,
      hidden: this.data.hidden,
      agent: this.buildAgent(),
      modes: jsonCodecs.stringArray(this.data.modes),
    };
  }

  private parseConfigOptions(): AgentConfigOption[] {
    return withCustomModels(
      jsonCodecs.agentConfigOptions(this.data.configOptions),
      decodeCustomModels(this.data.customModels),
    );
  }
}
