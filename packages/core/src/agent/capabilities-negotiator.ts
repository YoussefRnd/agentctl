import type { Provider } from './provider.js';
import type { ThinkingEffort } from '@agentctl/shared';

export interface NegotiatedCapabilities {
  selectedModel: string;
  selectedThinkingEffort: ThinkingEffort;
  supportsDynamicModel: boolean;
  supportsDynamicConfig: boolean;
}

export function negotiateCapabilities(
  provider: Provider,
  requestedModel: string | undefined,
  requestedThinkingEffort: ThinkingEffort | undefined,
): NegotiatedCapabilities {
  const defaultSelection = provider.resolveDefaultSelection();
  let selectedModel = requestedModel ?? defaultSelection.selectedModel;
  let selectedThinkingEffort = requestedThinkingEffort ?? defaultSelection.selectedThinkingEffort;

  const discovery = provider.toDiscovery();
  const configOptions = discovery.configOptions ?? [];

  // 1. Validate / Negotiate Model
  const modelOption = configOptions.find((opt) => opt.id === 'model' || opt.id === 'selectedModel');
  if (modelOption && selectedModel !== 'default' && selectedModel !== '') {
    const isModelAvailable = modelOption.options.some((opt) => opt.value === selectedModel);
    if (!isModelAvailable && modelOption.options.length > 0) {
      selectedModel = modelOption.options[0]?.value ?? defaultSelection.selectedModel;
    }
  }

  // 2. Validate / Negotiate Thinking Effort
  const thinkingOption = configOptions.find(
    (opt) => opt.id === 'thinking' || opt.id === 'thinking_effort' || opt.id === 'selectedThinkingEffort',
  );
  if (thinkingOption) {
    const isEffortAvailable = thinkingOption.options.some((opt) => opt.value === selectedThinkingEffort);
    if (!isEffortAvailable && thinkingOption.options.length > 0) {
      selectedThinkingEffort = (thinkingOption.options[0]?.value ??
        defaultSelection.selectedThinkingEffort) as ThinkingEffort;
    }
  }

  return {
    selectedModel,
    selectedThinkingEffort,
    supportsDynamicModel: provider.supportsDynamicModel,
    supportsDynamicConfig: provider.supportsDynamicConfig,
  };
}
