import { expect, it } from 'vitest';
import {
  findAgentConfigOption,
  getAgentConfigCategory,
  resolveThinkingEffort,
} from './agent-config.js';
import type { AgentConfigOption } from './schemas/registry.js';

const option = (id: string, category?: string): AgentConfigOption => ({
  id,
  category,
  name: id,
  type: 'select',
  currentValue: 'default',
});

it('prefers advertised categories over legacy aliases regardless of ordering', () => {
  const model = option('preferred_llm', 'model');
  const effort = option('reasoning_budget', 'thought_level');
  const options = [option('model'), option('thinking'), model, effort];
  expect(findAgentConfigOption(options, 'model')).toBe(model);
  expect(findAgentConfigOption(options, 'thought_level')).toBe(effort);
  expect(findAgentConfigOption([option('selectedModel')], 'model')?.id).toBe('selectedModel');
  expect(findAgentConfigOption([option('thinking_effort')], 'thought_level')?.id).toBe(
    'thinking_effort',
  );
});

it('respects explicit categories and safely handles unfamiliar IDs', () => {
  const unrelated = option('model', 'vendor_setting');
  expect(getAgentConfigCategory(unrelated)).toBe('vendor_setting');
  expect(findAgentConfigOption([unrelated], 'model')).toBeUndefined();
  expect(getAgentConfigCategory(option('toString'))).toBe('other');
  expect(findAgentConfigOption(undefined, 'model')).toBeUndefined();
});

it('uses advertised defaults and order without inventing an effort for unsupported providers', () => {
  expect(resolveThinkingEffort(undefined, 'high', 'medium')).toBeNull();
  const effort = { ...option('budget', 'thought_level'), currentValue: '' };
  expect(resolveThinkingEffort(effort, 'high')).toBeNull();
  const choices = {
    ...effort,
    currentValue: 'vendor-default',
    options: [
      { value: 'vendor-first', name: 'First' },
      { value: 'vendor-default', name: 'Default' },
    ],
  };
  expect(resolveThinkingEffort(choices)).toBe('vendor-default');
  expect(resolveThinkingEffort(choices, 'unavailable')).toBe('vendor-default');
  expect(resolveThinkingEffort({ ...choices, currentValue: '' })).toBe('vendor-first');
});
