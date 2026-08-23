import type { FontConfig } from '@agentctl/shared';

export const SIZE_MIN = 8;
export const SIZE_MAX = 72;

export type FontContextKey = keyof FontConfig;

export const LABELS: Record<FontContextKey, string> = {
  ui: 'UI',
  buffer: 'Buffer',
  terminal: 'Terminal',
  chat: 'Chat',
};

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
 * Clamp a font size to [min, max].
 */
export function clampSize(size: number, min = SIZE_MIN, max = SIZE_MAX): number {
  return Math.min(max, Math.max(min, size));
}

/**
 * Validate a raw string value as a known FontContextKey. The hook walks the DOM
 * for `data-font-ctx` and forwards the string here for safe validation, keeping
 * this module free of DOM dependencies so it runs under any test runner.
 */
export function resolveContextKey(value: unknown): FontContextKey | null {
  return typeof value === 'string' && value in LABELS ? (value as FontContextKey) : null;
}

/**
 * Map a keydown event (shape only, DOM-free) to a zoom action:
 * 1 = zoom in, -1 = zoom out, 0 = reset, null = not a zoom shortcut.
 */
export function keyboardStepFor(e: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
}): 1 | -1 | 0 | null {
  if (!e.ctrlKey && !e.metaKey) return null;
  if (e.key === '=' || e.key === '+') return 1;
  if (e.key === '-') return -1;
  if (e.key === '0') return 0;
  return null;
}

/**
 * Contexts to scale together: chat prose and terminal code stay in sync.
 */
export function resolveTargetContexts(rawCtx: FontContextKey): FontContextKey[] {
  return rawCtx === 'chat' || rawCtx === 'terminal' ? ['chat', 'terminal'] : [rawCtx];
}

/**
 * Gate ctrl/meta wheel events so they only count as a deliberate zoom gesture.
 * Touchpads can misfire pinch detection during plain two-finger scrolling
 * (emitted as ctrl+wheel bursts interleaved with normal scroll events).
 * A real pinch or Ctrl+wheel zoom has no plain scroll event in between.
 */
export function shouldProcessZoomWheel(
  lastPlainWheelAt: number | null,
  now: number,
  gapMs: number,
): boolean {
  return lastPlainWheelAt === null || now - lastPlainWheelAt >= gapMs;
}
