import { DEFAULT_AGENT_MODEL } from './agent-defaults.js';
import { z } from 'zod';
import { findAgentConfigOption } from './agent-config.js';
import type { AgentConfigOption } from './schemas/registry.js';

export const customModelSchema = z.object({
  id: z.string().trim().min(1).max(256),
  name: z.string().trim().min(1).max(100),
  contextWindow: z.number().int().positive().max(100_000_000).optional(),
});
export const customModelsSchema = z
  .array(customModelSchema)
  .max(100)
  .refine(
    (models) => new Set(models.map((model) => model.id)).size === models.length,
    'Custom model IDs must be unique',
  );
export type CustomModel = z.infer<typeof customModelSchema>;

export function decodeCustomModels(value: string | null | undefined): CustomModel[] {
  try {
    const parsed = customModelsSchema.safeParse(JSON.parse(value ?? '[]'));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

/** Keep agent IDs and advertised choices authoritative; append user-authored choices. */
export function withCustomModels(
  options: AgentConfigOption[],
  models: CustomModel[],
): AgentConfigOption[] {
  if (!models.length) return options;
  const modelOption = findAgentConfigOption(options, 'model');
  const choices = [...(modelOption?.options ?? [])];
  for (const model of models)
    if (!choices.some((choice) => choice.value === model.id))
      choices.push({ value: model.id, name: model.name, contextWindow: model.contextWindow });
  if (!modelOption)
    return [
      ...options,
      {
        id: 'model',
        category: 'model',
        name: 'Model',
        type: 'select',
        currentValue: DEFAULT_AGENT_MODEL,
        options: choices,
      },
    ];
  return options.map((option) =>
    option === modelOption ? { ...option, options: choices } : option,
  );
}
