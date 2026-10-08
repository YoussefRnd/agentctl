import { describe, expect, it } from 'vitest';
import { fuzzyScore, fuzzySearch } from './fuzzy-search.js';

describe('shared fuzzy search', () => {
  it('matches abbreviations in character order, case-insensitively', () => {
    expect(fuzzySearch(['terminal', 'mcp', 'review'], ' TRM ', (item) => [item])).toEqual([
      'terminal',
    ]);
    expect(fuzzyScore('terminal', 'tmr')).toBe(-1);
  });
  it('prefers exact and prefix matches', () => {
    expect(fuzzySearch(['test-runner', 'my-test', 'test'], 'test', (item) => [item])).toEqual([
      'test',
      'test-runner',
      'my-test',
    ]);
  });
  it('supports several fields and ignores absent fields', () => {
    const items = [{ name: 'index.ts', path: 'src/composer/index.ts' }, { name: 'README.md' }];
    expect(fuzzySearch(items, 'composer', (item) => [item.name, item.path])).toEqual([items[0]]);
  });
  it('preserves order for blank searches and ties without mutating the input', () => {
    const items = ['beta', 'alpha', 'alpha'];
    expect(fuzzySearch(items, '  ', (item) => [item])).toEqual(items);
    expect(fuzzySearch(items, 'alpha', (item) => [item])).toEqual(['alpha', 'alpha']);
    expect(items).toEqual(['beta', 'alpha', 'alpha']);
  });
  it('limits results after ranking, including an empty query', () => {
    expect(fuzzySearch(['my-test', 'test-runner', 'test'], 'test', (item) => [item], 1)).toEqual([
      'test',
    ]);
    expect(fuzzySearch(['a', 'b', 'c'], '', (item) => [item], 2)).toEqual(['a', 'b']);
  });
  it('returns no matches for unrelated queries', () => {
    expect(fuzzySearch(['terminal', 'mcp'], 'xyz', (item) => [item])).toEqual([]);
  });
});
