import {
  findAgentConfigOption,
  gitTextGenerationSettingsSchema,
  type GitTextGenerationSettings,
} from '@agentctl/shared';
import type { ProviderRegistry } from '../providers/provider-registry.js';

export function readGitTextGenerationSetting(raw?: string): GitTextGenerationSettings | null {
  if (!raw) return null;
  try {
    return gitTextGenerationSettingsSchema.nullable().parse(JSON.parse(raw));
  } catch {
    throw new Error(
      'Git text generation settings are invalid. Choose a provider and model again in Settings → General.',
    );
  }
}

export function validateGitTextGenerationSetting(
  registry: Pick<ProviderRegistry, 'getProvider'>,
  selection: GitTextGenerationSettings,
) {
  const provider = registry.getProvider(selection.providerId);
  const discovery = provider?.toDiscovery();
  if (!provider?.isInstalled || !discovery?.enabled || discovery.hidden) {
    throw new Error(
      'The Git generation provider is unavailable. Choose an enabled, installed provider in Settings → General.',
    );
  }
  if (selection.modelId !== null) {
    const models = findAgentConfigOption(discovery.configOptions, 'model')?.options ?? [];
    if (
      !models.some((model) => model.value === selection.modelId) &&
      !discovery.customModels?.some((model) => model.id === selection.modelId)
    ) {
      throw new Error(
        'The Git generation model is no longer available for this provider. Choose a model in Settings → General, or add it as a custom model in Providers.',
      );
    }
  }
  return provider;
}

export function resolveGitTextGenerationSelection(
  registry: Pick<ProviderRegistry, 'getProvider' | 'getSettings'>,
  session: { selectedProvider: string; selectedModel: string },
) {
  const selection = readGitTextGenerationSetting(registry.getSettings().gitTextGeneration);
  const provider = selection
    ? validateGitTextGenerationSetting(registry, selection)
    : registry.getProvider(session.selectedProvider);
  if (!provider?.isReady || !provider.toDiscovery().enabled) {
    throw new Error(
      selection
        ? 'Connect the selected Git generation provider in Settings → AI Providers, or change the generation setting. You can also write the draft manually.'
        : 'Connect the session provider before generating a draft, or write it manually.',
    );
  }
  const modelId = selection
    ? (selection.modelId ?? provider.resolveDefaultSelection().selectedModel)
    : session.selectedModel;
  return { provider, modelId };
}
