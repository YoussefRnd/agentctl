import type { FontConfig } from '@agentctl/shared';

export const SIZE_MIN = 8;
export const SIZE_MAX = 72;
export const DELTA_THRESHOLD = 20;

export type FontContextKey = keyof FontConfig;

export const LABELS: Record<FontContextKey, string> = {
  ui: 'UI',
  buffer: 'Buffer',
  terminal: 'Terminal',
  chat: 'Chat',
};

export const ALL_CONTEXT_KEYS: readonly FontContextKey[] = [
  'ui',
  'buffer',
  'terminal',
  'chat',
] as const;

export type Offsets = Record<FontContextKey, number>;

export function createEmptyOffsets(): Offsets {
  return { ui: 0, buffer: 0, terminal: 0, chat: 0 };
}

/**
 * Wheel deltaMode constants (mirrors WheelEvent.DOM_DELTA_* so this module
 * stays DOM-free and testable in any environment).
 */
const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;

/**
 * Normalize a raw wheel delta to pixels.
 * deltaMode: pixels (0) / lines (1) / pages (2).
 */
export function normalizeDelta(rawDelta: number, deltaMode: number): number {
  if (deltaMode === DOM_DELTA_LINE) return rawDelta * 16;
  if (deltaMode === DOM_DELTA_PAGE) return rawDelta * 500;
  return rawDelta;
}

/**
 * Consume accumulated delta into whole unit steps, preserving the remainder
 * for the next event. The hook decides which scroll direction maps to
 * grow/shrink — this function simply quantizes the raw delta.
 *
 * Positive accumulated → positive steps. Negative → negative.
 */
export function consumeDeltaSteps(
  accumulated: number,
  threshold: number,
): {
  steps: number;
  remainder: number;
} {
  if (Math.abs(accumulated) < threshold) return { steps: 0, remainder: accumulated };
  const steps = Math.trunc(accumulated / threshold);
  const remainder = accumulated - steps * threshold;
  return { steps, remainder };
}

/**
 * Apply N steps to an offset against a base size, clamping the *displayed size*
 * to [min, max] AND keeping the offset itself within the achievable range so
 * it never drifts out of bounds when the base changes later.
 */
export function clampSize(size: number, min = SIZE_MIN, max = SIZE_MAX): number {
  return Math.min(max, Math.max(min, size));
}

/**
 * Compute the new offset for a context given a step count, the current base
 * size and the previous offset. The offset is clamped so that base + offset
 * always stays in [min, max]; this prevents offset drift when the user's
 * persisted base changes mid-session.
 */
export function applySteps(
  steps: number,
  base: number,
  prevOffset: number,
  min = SIZE_MIN,
  max = SIZE_MAX,
): { offset: number; size: number } {
  const minOffset = min - base;
  const maxOffset = max - base;
  let next = prevOffset + steps;
  if (next < minOffset) next = minOffset;
  if (next > maxOffset) next = maxOffset;
  const size = clampSize(base + next, min, max);
  return { offset: next, size };
}

/**
 * Validate a raw string value as a known FontContextKey. The hook walks the DOM
 * for `data-font-ctx` and forwards the string here for safe validation, keeping
 * this module free of DOM dependencies so it runs under any test runner.
 */
export function resolveContextKey(value: unknown): FontContextKey | null {
  return typeof value === 'string' && value in LABELS ? (value as FontContextKey) : null;
}
