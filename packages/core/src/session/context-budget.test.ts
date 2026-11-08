import { expect, test } from 'vite-plus/test';
import { providerContextByteBudget, selectContextEntries } from './context-budget.js';

test('keeps original and latest messages whole, omitting oversized intermediate messages', () => {
  const entries = [
    { role: 'User', text: 'original request' },
    { role: 'Assistant', text: 'x'.repeat(10_000) },
    { role: 'User', text: 'latest request' },
    { role: 'Assistant', text: 'latest response' },
  ];
  expect(selectContextEntries(entries, 350)).toEqual([entries[0], entries[2], entries[3]]);
});

test('budgets history after existing occupancy, encoded input, skills and attachment allowances', () => {
  const input = {
    contextWindow: 128_000,
    usedTokens: 95_000,
    userText: 'Current request',
    instructions: 'Available skills',
    attachmentMimeTypes: [],
  };
  expect(providerContextByteBudget(input)).toBe(965);
  expect(providerContextByteBudget({ ...input, attachmentMimeTypes: ['image/png'] })).toBe(0);
  expect(providerContextByteBudget({ ...input, usedTokens: 0 })).toBe(16_000);
  expect(providerContextByteBudget({ ...input, userText: '\\'.repeat(1000) })).toBe(0);
});
test('accounts for UTF-8 bytes and skips whole oversized messages', () => {
  const entries = [{ role: 'User', text: '🚀'.repeat(100) }];
  expect(selectContextEntries(entries, 300)).toEqual([]);
  expect(selectContextEntries(entries, 500)).toEqual(entries);
});
