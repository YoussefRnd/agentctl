import type {
  ACPConfigOption,
  AuthMethod,
  ProviderDiscovery,
  ThinkingEffort,
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

  get status(): ProviderData['status'] {
    return this.data.status;
  }

  get enabled(): boolean {
    return this.data.enabled;
  }

  get supportsDynamicModel(): boolean {
    return this.data.supportsDynamicModel;
  }

  get supportsDynamicConfig(): boolean {
    return this.data.supportsDynamicConfig;
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
      this.id !== 'opencode' &&
      !this.supportsDynamicModel &&
      hasModelOption &&
      selectedModel &&
      selectedModel !== 'default'
    ) {
      extraArgs.push('--model', selectedModel);
    }

    if (
      this.id !== 'opencode' &&
      !this.supportsDynamicConfig &&
      hasThinkingOption &&
      selectedThinkingEffort
    ) {
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

  toDiscovery(): ProviderDiscovery {
    return {
      id: this.data.id,
      label: this.data.name,
      status: this.data.status,
      command: this.data.command,
      enabled: this.data.enabled,
      launchArgs: this.parseStringArray(this.data.launchArgs),
      launchEnv: this.parseStringRecord(this.data.launchEnv),
      customEnv: this.parseStringRecord(this.data.customEnv),
      configOptions: this.parseConfigOptions(),
      authMethods: this.parseAuthMethods(),
      version: this.data.version ?? undefined,
      description: this.data.description ?? undefined,
      icon: this.data.icon ?? undefined,
      supportsDynamicModel: this.data.supportsDynamicModel,
      supportsDynamicConfig: this.data.supportsDynamicConfig,
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
}
