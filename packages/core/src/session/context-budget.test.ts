import { expect, test } from 'vite-plus/test';
import {
  contextByteBudget,
  providerContextByteBudget,
  selectContextEntries,
} from './context-budget.js';

test('reserves context for instructions, tools, prompts, and output', () => {
  expect(contextByteBudget(8_000)).toBe(3_200);
  expect(contextByteBudget()).toBe(12_800);
  expect(contextByteBudget(1_000_000)).toBe(32_768);
});
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
