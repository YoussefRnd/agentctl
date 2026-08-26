import type { FontConfig } from '@agentctl/shared';

export const SIZE_MIN = 8;
export const SIZE_MAX = 72;

export const ZOOM_MIN = 70;
export const ZOOM_MAX = 170;
export const ZOOM_DEFAULT = 100;
export const ZOOM_STEP = 5;

export type FontConfigKey = keyof FontConfig;
export type FontContextKey = FontConfigKey | 'window';

export const LABELS: Record<FontContextKey, string> = {
  ui: 'UI & Text',
  code: 'Code & Terminal',
  window: 'Window Zoom',
};

/**
 * Clamp window zoom percentage to [min, max].
 */
export function clampZoom(zoom: number, min = ZOOM_MIN, max = ZOOM_MAX): number {
  return Math.min(max, Math.max(min, Math.round(zoom)));
}

/**
 * Clamp a font size to [min, max].
 */
export function clampSize(size: number, min = SIZE_MIN, max = SIZE_MAX): number {
  return Math.min(max, Math.max(min, size));
}

/**
 * Validate a raw string value as a known FontContextKey.
 */
export function resolveContextKey(value: unknown): FontContextKey | null {
  if (typeof value !== 'string') return null;
  if (value === 'ui' || value === 'chat') return 'ui';
  if (value === 'code' || value === 'buffer' || value === 'terminal') return 'code';
  if (value === 'window') return 'window';
  return null;
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
