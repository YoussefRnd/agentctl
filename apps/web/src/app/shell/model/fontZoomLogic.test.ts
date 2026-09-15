import { describe, it, expect } from 'vitest';
import {
  clampSize,
  clampZoom,
  resolveContextKey,
  keyboardStepFor,
  SIZE_MIN,
  SIZE_MAX,
} from './fontZoomLogic';

describe('clampSize', () => {
  it('clamps to min and max bounds', () => {
    expect(clampSize(SIZE_MIN - 10)).toBe(SIZE_MIN);
    expect(clampSize(SIZE_MAX + 10)).toBe(SIZE_MAX);
    expect(clampSize(14)).toBe(14);
  });
});

describe('clampZoom', () => {
  it('clamps window zoom percentage within bounds', () => {
    expect(clampZoom(50)).toBe(70);
    expect(clampZoom(200)).toBe(170);
    expect(clampZoom(115)).toBe(115);
  });
});

describe('resolveContextKey', () => {
  it('maps ui and chat to ui', () => {
    expect(resolveContextKey('ui')).toBe('ui');
    expect(resolveContextKey('chat')).toBe('ui');
  });

  it('maps code, terminal, and buffer to code', () => {
    expect(resolveContextKey('code')).toBe('code');
    expect(resolveContextKey('terminal')).toBe('code');
    expect(resolveContextKey('buffer')).toBe('code');
  });

  it('accepts window context', () => {
    expect(resolveContextKey('window')).toBe('window');
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
