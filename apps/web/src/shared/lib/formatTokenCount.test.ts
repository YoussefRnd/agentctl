import { describe, expect, it } from 'vitest';
import { formatTokenCount } from './formatTokenCount';

describe('formatTokenCount', () => {
  it('scales token counts from thousands to millions without showing 1000K', () => {
    expect(formatTokenCount(70400)).toBe('70.4K');
    expect(formatTokenCount(999949)).toBe('999.9K');
    expect(formatTokenCount(999950)).toBe('1M');
    expect(formatTokenCount(1000000)).toBe('1M');
    expect(formatTokenCount(1250000)).toBe('1.3M');
  });
});
