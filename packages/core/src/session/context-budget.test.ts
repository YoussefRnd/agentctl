import { expect, test } from 'vite-plus/test';
import { contextByteBudget, selectContextEntries } from './context-budget.js';

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
  expect(selectContextEntries(entries, 250)).toEqual([entries[0], entries[2], entries[3]]);
});
test('accounts for UTF-8 bytes and skips whole oversized messages', () => {
  const entries = [{ role: 'User', text: '🚀'.repeat(100) }];
  expect(selectContextEntries(entries, 300)).toEqual([]);
  expect(selectContextEntries(entries, 500)).toEqual(entries);
});
