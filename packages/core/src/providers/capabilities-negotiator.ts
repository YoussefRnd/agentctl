import type { Provider } from './provider.js';
import {
  DEFAULT_AGENT_MODEL,
  findAgentConfigOption,
  resolveThinkingEffort,
  type AgentFeatures,
  type ThinkingEffort,
} from '@agentctl/shared';

export interface NegotiatedCapabilities {
  selectedModel: string;
  contextWindow?: number;
  selectedThinkingEffort: ThinkingEffort;
  features: AgentFeatures;
  modelFallback?: { requested: string; selected: string };
  resolvedThinkingConfigId?: string;
  resolvedModelConfigId?: string;
}

export function negotiateCapabilities(
  provider: Provider,
  requestedModel: string | undefined,
  requestedThinkingEffort: ThinkingEffort | undefined,
): NegotiatedCapabilities {
  const defaultSelection = provider.resolveDefaultSelection();
  let selectedModel = requestedModel ?? defaultSelection.selectedModel;

  const discovery = provider.toDiscovery();
  const configOptions = discovery.configOptions ?? [];

  let modelFallback: NegotiatedCapabilities['modelFallback'];

  // 1. Validate / Negotiate Model
  const modelOption = findAgentConfigOption(configOptions, 'model');
  let resolvedModelConfigId: string | undefined = undefined;
  if (modelOption) {
    resolvedModelConfigId = modelOption.id;
    if (selectedModel !== DEFAULT_AGENT_MODEL && selectedModel !== '') {
      const isModelAvailable =
        modelOption.options?.some((opt: { value: string }) => opt.value === selectedModel) ?? false;
      if (!isModelAvailable && (modelOption.options?.length ?? 0) > 0) {
        const requested = selectedModel;
        const advertisedDefault =
          typeof modelOption.currentValue === 'string' ? modelOption.currentValue : '';
        selectedModel = modelOption.options?.some((option) => option.value === advertisedDefault)
          ? advertisedDefault
          : modelOption.options![0].value;
        modelFallback = { requested, selected: selectedModel };
      }
    }
  }

  // 2. Validate / Negotiate Thinking Effort
  const thinkingOption = findAgentConfigOption(configOptions, 'thought_level');
  const resolvedThinkingConfigId = thinkingOption?.id;
  const selectedThinkingEffort = resolveThinkingEffort(
    thinkingOption,
    requestedThinkingEffort,
    defaultSelection.selectedThinkingEffort,
  );

  return {
    selectedModel,
    contextWindow: modelOption?.options?.find((option) => option.value === selectedModel)
      ?.contextWindow,
    modelFallback,
    selectedThinkingEffort,
    features: provider.features,
    resolvedThinkingConfigId,
    resolvedModelConfigId,
  };
}
