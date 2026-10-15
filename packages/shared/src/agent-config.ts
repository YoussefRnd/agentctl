import type { AgentConfigOption } from './schemas/registry.js';
import { isThinkingEffort } from './agent-defaults.js';

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

/** Prefer requested/default IDs only when the provider advertises them. */
export function resolveThinkingEffort(
  option: AgentConfigOption | undefined,
  requested?: string | null,
  configuredDefault?: string | null,
): string | null {
  if (!option) return null;
  const choices = option.options ?? [];
  for (const value of [requested, configuredDefault, option.currentValue]) {
    if (
      isThinkingEffort(value) &&
      (choices.length === 0
        ? value === option.currentValue
        : choices.some((choice) => choice.value === value))
    )
      return value;
  }
  return choices[0]?.value ?? null;
}
