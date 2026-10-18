import { expect, test } from 'vite-plus/test';
import { customModelsSchema, withCustomModels } from './custom-models.js';

test('appends custom models while preserving agent IDs and advertised metadata', () => {
  const options = [
    {
      id: 'llm',
      name: 'Model',
      category: 'model',
      type: 'select' as const,
      currentValue: 'native',
      options: [{ value: 'native', name: 'Native', contextWindow: 1000 }],
    },
  ];
  const merged = withCustomModels(options, [
    { id: 'native', name: 'Override' },
    { id: 'hidden', name: 'Hidden', contextWindow: 2000 },
  ]);
  expect(merged[0]).toMatchObject({
    id: 'llm',
    options: [
      { value: 'native', name: 'Native', contextWindow: 1000 },
      { value: 'hidden', name: 'Hidden', contextWindow: 2000 },
    ],
  });
  expect(options[0].options).toHaveLength(1);
  expect(withCustomModels([], [{ id: 'hidden', name: 'Hidden' }])[0]).toMatchObject({
    category: 'model',
    options: [{ value: 'hidden' }],
  });
});

test('rejects duplicate custom IDs and invalid context windows', () => {
  expect(
    customModelsSchema.safeParse([
      { id: 'x', name: 'X' },
      { id: 'x', name: 'Other' },
    ]).success,
  ).toBe(false);
  expect(customModelsSchema.safeParse([{ id: 'x', name: 'X', contextWindow: -1 }]).success).toBe(
    false,
  );
});
