import { expect, test } from 'vitest';
import { projectSelectOptions } from './events.js';
import { projectV2ConfigOption } from '../v2/events.js';

test('retains explicit context windows from grouped v1 and v2 model choices', () => {
  const item = {
    value: 'model',
    name: 'Model',
    _meta: { contextWindow: 8_000, vendorPrivate: 'omit' },
  };
  expect(projectSelectOptions([{ group: 'models', name: 'Models', options: [item] }])).toEqual([
    { value: 'model', name: 'Model', description: undefined, contextWindow: 8_000 },
  ]);
  expect(
    projectV2ConfigOption({
      type: 'select',
      configId: 'llm',
      category: 'model',
      name: 'Model',
      currentValue: 'model',
      options: [{ groupId: 'models', name: 'Models', options: [item] }],
    })?.options?.[0],
  ).toEqual({ value: 'model', name: 'Model', description: undefined, contextWindow: 8_000 });
});
