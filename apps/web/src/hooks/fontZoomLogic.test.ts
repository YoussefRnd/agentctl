import { describe, it, expect } from 'vitest';
import {
  normalizeDelta,
  consumeDeltaSteps,
  clampSize,
  resolveContextKey,
  keyboardStepFor,
  resolveTargetContexts,
  shouldProcessZoomWheel,
  SIZE_MIN,
  SIZE_MAX,
  type FontContextKey,
} from './fontZoomLogic';

describe('normalizeDelta', () => {
  it('passes pixel deltas through unchanged', () => {
    expect(normalizeDelta(10, 0)).toBe(10);
    expect(normalizeDelta(-10, 0)).toBe(-10);
  });

  it('converts line deltas to pixels', () => {
    expect(normalizeDelta(3, 1)).toBe(48);
  });

  it('converts page deltas to pixels', () => {
    expect(normalizeDelta(1, 2)).toBe(500);
  });
});

describe('consumeDeltaSteps', () => {
  it('returns zero steps and keeps remainder below threshold', () => {
    expect(consumeDeltaSteps(15, 40)).toEqual({ steps: 0, remainder: 15 });
  });

  it('quantizes accumulated delta into whole steps', () => {
    expect(consumeDeltaSteps(100, 40)).toEqual({ steps: 2, remainder: 20 });
  });

  it('preserves sign for negative deltas', () => {
    expect(consumeDeltaSteps(-100, 40)).toEqual({ steps: -2, remainder: -20 });
  });
});

describe('clampSize', () => {
  it('clamps to min and max bounds', () => {
    expect(clampSize(SIZE_MIN - 10)).toBe(SIZE_MIN);
    expect(clampSize(SIZE_MAX + 10)).toBe(SIZE_MAX);
    expect(clampSize(14)).toBe(14);
  });
});

describe('resolveContextKey', () => {
  it('accepts known context keys', () => {
    expect(resolveContextKey('ui')).toBe('ui');
    expect(resolveContextKey('chat')).toBe('chat');
    expect(resolveContextKey('terminal')).toBe('terminal');
    expect(resolveContextKey('buffer')).toBe('buffer');
  });

  it('rejects unknown values', () => {
    expect(resolveContextKey('nope')).toBeNull();
    expect(resolveContextKey(undefined)).toBeNull();
    expect(resolveContextKey(null)).toBeNull();
    expect(resolveContextKey(42)).toBeNull();
  });
});

describe('keyboardStepFor', () => {
  const withMod = (key: string, mod: 'ctrl' | 'meta') => ({
    key,
    ctrlKey: mod === 'ctrl',
    metaKey: mod === 'meta',
  });

  it('maps Ctrl/Meta + = or + to zoom in', () => {
    expect(keyboardStepFor(withMod('=', 'ctrl'))).toBe(1);
    expect(keyboardStepFor(withMod('+', 'ctrl'))).toBe(1);
    expect(keyboardStepFor(withMod('=', 'meta'))).toBe(1);
  });

  it('maps Ctrl/Meta + - to zoom out', () => {
    expect(keyboardStepFor(withMod('-', 'ctrl'))).toBe(-1);
    expect(keyboardStepFor(withMod('-', 'meta'))).toBe(-1);
  });

  it('maps Ctrl/Meta + 0 to reset', () => {
    expect(keyboardStepFor(withMod('0', 'ctrl'))).toBe(0);
    expect(keyboardStepFor(withMod('0', 'meta'))).toBe(0);
  });

  it('ignores keys without a modifier', () => {
    expect(keyboardStepFor({ key: '=', ctrlKey: false, metaKey: false })).toBeNull();
    expect(keyboardStepFor({ key: '-', ctrlKey: false, metaKey: false })).toBeNull();
  });

  it('ignores unrelated modified keys', () => {
    expect(keyboardStepFor(withMod('a', 'ctrl'))).toBeNull();
    expect(keyboardStepFor(withMod('Enter', 'meta'))).toBeNull();
  });
});

describe('resolveTargetContexts', () => {
  const cases: [FontContextKey, FontContextKey[]][] = [
    ['chat', ['chat', 'terminal']],
    ['terminal', ['chat', 'terminal']],
    ['ui', ['ui']],
    ['buffer', ['buffer']],
  ];

  it('groups chat and terminal together', () => {
    for (const [input, expected] of cases) {
      expect(resolveTargetContexts(input)).toEqual(expected);
    }
  });
});

describe('shouldProcessZoomWheel', () => {
  it('accepts zoom events when no plain scroll happened recently', () => {
    expect(shouldProcessZoomWheel(null, 1000, 150)).toBe(true);
    expect(shouldProcessZoomWheel(500, 1000, 150)).toBe(true);
  });

  it('rejects zoom events interleaved with plain scroll', () => {
    expect(shouldProcessZoomWheel(990, 1000, 150)).toBe(false);
  });
});
