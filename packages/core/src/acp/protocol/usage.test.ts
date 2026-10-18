import { expect, test } from 'vite-plus/test';
import { normalizeAcpUsage } from './usage.js';

test('normalizes legacy usage aliases at the ACP boundary', () => {
  expect(
    normalizeAcpUsage({
      prompt_tokens: '12',
      completionTokens: 4,
      total_tokens: 16,
      cost: { amount: '0.02', currency: 'EUR' },
      _meta: { private: true },
    }),
  ).toMatchObject({
    inputTokens: 12,
    outputTokens: 4,
    totalTokens: 16,
    cost: { amount: 0.02, currency: 'EUR' },
  });
});

test('does not turn null or blank usage fields into zero', () => {
  expect(normalizeAcpUsage({ inputTokens: null, outputTokens: '' })).toMatchObject({
    inputTokens: undefined,
    outputTokens: undefined,
  });
});
