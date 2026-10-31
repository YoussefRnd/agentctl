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

test.each([
  undefined,
  {},
  { amount: null, currency: 'USD' },
  { amount: '', currency: 'USD' },
  { amount: -1, currency: 'USD' },
  { amount: Number.NaN, currency: 'USD' },
  { amount: Infinity, currency: 'USD' },
  { amount: 1 },
  { amount: 1, currency: ' ' },
])('does not fabricate a known cost from %j', (cost) => {
  expect(normalizeAcpUsage({ cost })?.cost).toBeUndefined();
});

test('preserves explicitly reported zero and trims the supplied currency', () => {
  expect(normalizeAcpUsage({ cost: { amount: '0', currency: ' EUR ' } })?.cost).toEqual({
    amount: 0,
    currency: 'EUR',
  });
});

test('does not turn null or blank usage fields into zero', () => {
  expect(normalizeAcpUsage({ inputTokens: null, outputTokens: '' })).toMatchObject({
    inputTokens: undefined,
    outputTokens: undefined,
  });
});
