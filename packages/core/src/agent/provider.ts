import type {
  ACPConfigOption,
  AuthMethod,
  ProviderDiscovery,
  ProviderStatus,
  ThinkingEffort,
  RegistryAgent,
} from '@agentctl/shared';
import type { providers } from '../db/schema.js';

export type ProviderData = typeof providers.$inferSelect;

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

  get authState(): string {
    return this.data.authState;
  }

  get isInstalled(): boolean {
    return this.data.installState !== 'not_installed';
  }

  get isReady(): boolean {
    return this.data.installState !== 'not_installed' && this.data.authState === 'authenticated';
  }

  get needsAuth(): boolean {
    return this.data.installState !== 'not_installed' && this.data.authState === 'needs_auth';
  }

  get hasError(): boolean {
    return this.data.authState === 'error';
  }

  get status(): ProviderStatus {
    if (!this.data.enabled) return 'inactive';
    if (this.data.installState === 'not_installed') return 'not_found';
    if (this.data.authState === 'needs_auth') return 'needs_auth';
    if (this.data.authState === 'error') return 'error';
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

  getLaunchConfig(selectedModel: string, selectedThinkingEffort: string): ProviderLaunchConfig {
    const extraArgs: string[] = [];
    const configOptions = this.parseConfigOptions();

    const hasModelOption = configOptions.some((opt) =>
      (MODEL_OPTION_IDS as readonly string[]).includes(opt.id),
    );
    const hasThinkingOption = configOptions.some((opt) =>
      (THINKING_OPTION_IDS as readonly string[]).includes(opt.id),
    );

    if (
      !this.supportsDynamicModel &&
      hasModelOption &&
      selectedModel &&
      selectedModel !== 'default' &&
      !this.supportsDynamicConfig
    ) {
      extraArgs.push('--model', selectedModel);
    }

    if (!this.supportsDynamicConfig && hasThinkingOption && selectedThinkingEffort) {
      extraArgs.push('--thinking-effort', selectedThinkingEffort);
    }

    return {
      command: this.data.command,
      args: [...this.parseStringArray(this.data.launchArgs), ...extraArgs],
      env: {
        ...this.parseStringRecord(this.data.launchEnv),
        ...this.parseStringRecord(this.data.customEnv),
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
      selectedModel: modelOption?.currentValue ?? modelOption?.options[0]?.value ?? 'default',
      selectedThinkingEffort: (thinkingOption?.currentValue ??
        thinkingOption?.options[0]?.value ??
        'medium') as ThinkingEffort,
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
      nativelyLoadsSkills: this.data.nativelyLoadsSkills,
      installState: this.data.installState as ProviderDiscovery['installState'],
      authState: this.data.authState as ProviderDiscovery['authState'],
      status: this.status,
      enabled: this.data.enabled,
      hidden: this.data.hidden,
      agent: this.buildAgent(),
    };
  }

  private parseStringArray(value: string | null | undefined): string[] {
    if (!value) return [];
    try {
      return JSON.parse(value) as string[];
    } catch {
      return [];
    }
  }

  private parseStringRecord(value: string | null | undefined): Record<string, string> {
    if (!value) return {};
    try {
      return JSON.parse(value) as Record<string, string>;
    } catch {
      return {};
    }
  }

  private parseConfigOptions(
    value: string | null | undefined = this.data.configOptions,
  ): ACPConfigOption[] {
    if (!value) return [];
    try {
      return JSON.parse(value) as ACPConfigOption[];
    } catch {
      return [];
    }
  }

  private parseAuthMethods(value: string | null | undefined = this.data.authMethods): AuthMethod[] {
    if (!value) return [];
    try {
      return JSON.parse(value) as AuthMethod[];
    } catch {
      return [];
    }
  }

  private parseDistribution(
    value: string | null | undefined = this.data.distribution,
  ): RegistryAgent['distribution'] {
    if (!value) return {};
    try {
      return JSON.parse(value) as RegistryAgent['distribution'];
    } catch {
      return {};
    }
  }
}
