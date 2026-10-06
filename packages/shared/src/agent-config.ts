import type { AgentConfigOption } from './schemas/registry.js';

export type AgentConfigCategory = 'model' | 'thought_level' | 'mode';

const legacyCategories: Record<string, AgentConfigCategory> = {
  model: 'model',
  selectedModel: 'model',
  thinking: 'thought_level',
  thinking_effort: 'thought_level',
  selectedThinkingEffort: 'thought_level',
  thought_level: 'thought_level',
  mode: 'mode',
};

/** Advertised categories take precedence over historical config IDs. */
export function getAgentConfigCategory(option: AgentConfigOption): string {
  return (
    option.category ||
    (Object.hasOwn(legacyCategories, option.id) ? legacyCategories[option.id] : 'other')
  );
}

/** Prefer a categorized option when a provider also advertises a legacy alias. */
export function findAgentConfigOption(
  options: readonly AgentConfigOption[] | undefined,
  category: AgentConfigCategory,
): AgentConfigOption | undefined {
  return (
    options?.find((option) => option.category === category) ??
    options?.find((option) => !option.category && getAgentConfigCategory(option) === category)
  );
}
