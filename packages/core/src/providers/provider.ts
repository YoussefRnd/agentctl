import type {
  AgentConfigOption,
  AuthState,
  AuthMethod,
  ConnectionState,
  InstallSource,
  InstallStage,
  ProviderDiscovery,
  ProviderStatus,
  ThinkingEffort,
  RegistryAgent,
} from '@agentctl/shared';
import type { providers } from '../db/schema.js';
import { DEFAULT_AGENT_MODEL, DEFAULT_THINKING_EFFORT } from '../config/runtime-defaults.js';
import { jsonCodecs } from '../db/json-codecs.js';
import { defaultCredentialVault } from '../security/credential-vault.js';

export type ProviderData = Omit<
  typeof providers.$inferSelect,
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

const MODEL_OPTION_IDS = ['model', 'selectedModel'] as const;
const THINKING_OPTION_IDS = ['thinking', 'thinking_effort', 'selectedThinkingEffort'] as const;

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

    const hasModelOption = configOptions.some((opt) =>
      (MODEL_OPTION_IDS as readonly string[]).includes(opt.id),
    );
    const hasThinkingOption = configOptions.some((opt) =>
      (THINKING_OPTION_IDS as readonly string[]).includes(opt.id),
    );

    if (
      !features.configuration.model &&
      hasModelOption &&
      selectedModel &&
      selectedModel !== 'default' &&
      !features.configuration.options
    ) {
      extraArgs.push('--model', selectedModel);
    }

    if (!features.configuration.options && hasThinkingOption && selectedThinkingEffort) {
      extraArgs.push('--thinking-effort', selectedThinkingEffort);
    }

    return {
      command: this.data.command,
      args: [...this.parseStringArray(this.data.launchArgs), ...extraArgs],
      env: {
        ...this.parseStringRecord(this.data.launchEnv),
        ...defaultCredentialVault.resolveEnvSync(this.parseStringRecord(this.data.customEnv)),
      },
    };
  }

  resolveDefaultSelection(): {
    selectedModel: string;
    selectedThinkingEffort: ThinkingEffort;
  } {
    const configOptions = this.parseConfigOptions();
    const modelOption = configOptions.find((opt) =>
      (MODEL_OPTION_IDS as readonly string[]).includes(opt.id),
    );
    const thinkingOption = configOptions.find((opt) =>
      (THINKING_OPTION_IDS as readonly string[]).includes(opt.id),
    );

    return {
      selectedModel:
        (typeof modelOption?.currentValue === 'string'
          ? modelOption.currentValue
          : modelOption?.options?.[0]?.value) ?? DEFAULT_AGENT_MODEL,
      selectedThinkingEffort: (thinkingOption?.currentValue ??
        thinkingOption?.options?.[0]?.value ??
        DEFAULT_THINKING_EFFORT) as ThinkingEffort,
    };
  }

  private buildAgent(): RegistryAgent {
    return {
      id: this.data.id,
      name: this.data.name,
      version: this.data.version ?? '',
      description: this.data.description ?? '',
      authors: [],
      distribution: this.parseDistribution(),
      icon: this.data.icon ?? undefined,
      configOptions: this.parseConfigOptions(),
      authMethods: this.parseAuthMethods(),
      supportsDynamicModel: this.data.supportsDynamicModel,
      supportsDynamicConfig: this.data.supportsDynamicConfig,
      supportsLogout: this.data.supportsLogout,
      features: this.features,
    };
  }

  toDiscovery(): ProviderDiscovery {
    const rawCustomEnv = this.parseStringRecord(this.data.customEnv);
    const customEnvConfigured: Record<string, boolean> = {};
    const redactedCustomEnv: Record<string, string> = {};

    for (const [key, value] of Object.entries(rawCustomEnv)) {
      customEnvConfigured[key] = value !== '';
      redactedCustomEnv[key] = '';
    }

    return {
      id: this.data.id,
      label: this.data.name,
      command: this.data.command,
      launchArgs: this.parseStringArray(this.data.launchArgs),
      launchEnv: this.parseStringRecord(this.data.launchEnv),
      customEnv: redactedCustomEnv,
      customEnvConfigured,
      configOptions: this.parseConfigOptions(),
      authMethods: this.parseAuthMethods(),
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
    };
  }

  private parseStringArray(value: string | null | undefined): string[] {
    return jsonCodecs.stringArray(value);
  }

  private parseStringRecord(value: string | null | undefined): Record<string, string> {
    return jsonCodecs.stringRecord(value);
  }

  private parseConfigOptions(
    value: string | null | undefined = this.data.configOptions,
  ): AgentConfigOption[] {
    return jsonCodecs.agentConfigOptions(value);
  }

  private parseAuthMethods(value: string | null | undefined = this.data.authMethods): AuthMethod[] {
    return jsonCodecs.authMethods(value);
  }

  private parseDistribution(
    value: string | null | undefined = this.data.distribution,
  ): RegistryAgent['distribution'] {
    return jsonCodecs.registryDistribution(value);
  }
}
