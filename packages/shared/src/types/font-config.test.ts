import { describe, it, expect } from 'vitest';
import { DEFAULT_FONT_CONFIG, isValidFontSize } from './font-config.js';

describe('DEFAULT_FONT_CONFIG', () => {
  const contexts = [
    DEFAULT_FONT_CONFIG.ui,
    DEFAULT_FONT_CONFIG.buffer,
    DEFAULT_FONT_CONFIG.terminal,
    DEFAULT_FONT_CONFIG.chat,
  ];

  it('has no null families', () => {
    for (const ctx of contexts) {
      expect(ctx.family).toBeTypeOf('string');
    }
  });

  it('has sizes in range', () => {
    for (const ctx of contexts) {
      expect(ctx.size).toBeGreaterThanOrEqual(8);
      expect(ctx.size).toBeLessThanOrEqual(72);
    }
  });

  it('all four contexts present', () => {
    expect(DEFAULT_FONT_CONFIG.ui).toBeDefined();
    expect(DEFAULT_FONT_CONFIG.buffer).toBeDefined();
    expect(DEFAULT_FONT_CONFIG.terminal).toBeDefined();
    expect(DEFAULT_FONT_CONFIG.chat).toBeDefined();
  });
});

describe('isValidFontSize', () => {
  it('returns true for valid sizes', () => {
    expect(isValidFontSize(8)).toBe(true);
    expect(isValidFontSize(14)).toBe(true);
    expect(isValidFontSize(72)).toBe(true);
  });

  it('returns false for out-of-range sizes', () => {
    expect(isValidFontSize(7)).toBe(false);
    expect(isValidFontSize(73)).toBe(false);
  });

  it('returns false for non-integers', () => {
    expect(isValidFontSize(14.5)).toBe(false);
  });

  it('returns false for non-numbers', () => {
    expect(isValidFontSize('14')).toBe(false);
    expect(isValidFontSize(null)).toBe(false);
    expect(isValidFontSize(undefined)).toBe(false);
  });
});
