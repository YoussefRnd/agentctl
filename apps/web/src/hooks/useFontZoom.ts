import { useEffect, useRef, useState } from 'react';
import { DEFAULT_FONT_CONFIG, type FontConfig } from '@agentctl/shared';
import {
  clampSize,
  consumeDeltaSteps,
  keyboardStepFor,
  normalizeDelta,
  resolveContextKey,
  resolveTargetContexts,
  shouldProcessZoomWheel,
  type FontContextKey,
} from './fontZoomLogic';
import { useSettings } from './useSettings';

const INDICATOR_DURATION = 1500;
const WHEEL_SENSITIVITY = 40; // Pixels of pinch delta required for 1px font size change
const SCROLL_ZOOM_GAP_MS = 150; // Plain scroll within this window kills a ctrl+wheel zoom burst

export interface ZoomIndicatorState {
  context: FontContextKey;
  size: number;
  visible: boolean;
}

const HIDDEN_INDICATOR: ZoomIndicatorState = { context: 'ui', size: 0, visible: false };

let zoomListeners: ((steps: number) => void)[] = [];

/** Dispatch a zoom request from outside the hook (e.g. menu items). 0 = reset. */
export function requestFontZoom(steps: number): void {
  for (const listener of zoomListeners) listener(steps);
}

export function requestFontZoomReset(): void {
  requestFontZoom(0);
}

/**
 * Trackpad & Font Zoom Hook.
 *
 * Zoom writes straight into the persisted `fontConfig` setting (VS Code style):
 * each step is ±1px on the active context's font size, clamped to [8, 72], and
 * PATCHed to the server. `FontConfigApplier` re-applies the vars from the
 * updated settings, so there is exactly one writer for the CSS variables.
 *
 * - Normal 2-finger trackpad scrolling (ctrlKey = false) is completely ignored
 *   so chat scrolling is 100% smooth, natural, and never glitches.
 * - Trackpad pinch gestures & Ctrl+Wheel (ctrlKey = true) dynamically adjust
 *   font sizes for the active context pane.
 * - Ctrl/Cmd + = / - / 0 adjust or reset font sizes for the last zoomed context.
 * - Groups `chat` and `terminal` together so prose and code blocks scale in sync.
 */
export function useFontZoom(): ZoomIndicatorState {
  const { settings, updateSettings } = useSettings();
  const [indicator, setIndicator] = useState<ZoomIndicatorState>(HIDDEN_INDICATOR);
  const accumulatedDeltaRef = useRef<number>(0);
  const lastContextRef = useRef<FontContextKey>('ui');
  const lastPlainWheelAtRef = useRef<number | null>(null);

  const fontConfigRef = useRef<FontConfig | undefined>(settings?.fontConfig);
  const updateSettingsRef = useRef(updateSettings);

  useEffect(() => {
    fontConfigRef.current = settings?.fontConfig;
  }, [settings?.fontConfig]);

  useEffect(() => {
    updateSettingsRef.current = updateSettings;
  }, [updateSettings]);

  useEffect(() => {
    let hideTimerId: ReturnType<typeof setTimeout> | undefined;

    const showIndicator = (context: FontContextKey, size: number) => {
      setIndicator({ context, size, visible: true });
      clearTimeout(hideTimerId);
      hideTimerId = setTimeout(() => {
        setIndicator((prev) => ({ ...prev, visible: false }));
      }, INDICATOR_DURATION);
    };

    const persist = (fontConfig: FontConfig) => {
      void updateSettingsRef.current({ fontConfig });
    };

    const applyZoom = (steps: number, rawCtx: FontContextKey) => {
      const base = fontConfigRef.current;
      if (!base) return;
      lastContextRef.current = rawCtx;

      const targets = resolveTargetContexts(rawCtx);
      const next: FontConfig = { ...base };
      for (const ctx of targets) {
        next[ctx] = { ...base[ctx], size: clampSize(base[ctx].size + steps) };
      }
      showIndicator(rawCtx, next[targets[0]].size);
      persist(next);
    };

    const resetAll = () => {
      setIndicator(HIDDEN_INDICATOR);
      const base = fontConfigRef.current;
      const next: FontConfig = base
        ? {
            ui: { family: base.ui.family, size: DEFAULT_FONT_CONFIG.ui.size },
            buffer: { family: base.buffer.family, size: DEFAULT_FONT_CONFIG.buffer.size },
            terminal: { family: base.terminal.family, size: DEFAULT_FONT_CONFIG.terminal.size },
            chat: { family: base.chat.family, size: DEFAULT_FONT_CONFIG.chat.size },
          }
        : DEFAULT_FONT_CONFIG;
      persist(next);
    };

    const onWheel = (e: WheelEvent) => {
      const now = performance.now();
      const isZoomModifier = e.ctrlKey || e.metaKey;

      // CRITICAL: Plain 2-finger trackpad scrolling has ctrlKey = false and MUST be ignored.
      if (!isZoomModifier) {
        lastPlainWheelAtRef.current = now;
        accumulatedDeltaRef.current = 0;
        return;
      }

      // Kill pinch-misdetect bursts that are interleaved with plain scrolling.
      // preventDefault runs for every ctrl/meta wheel event so Chrome's native
      // page zoom can never hijack a misdetected gesture.
      e.preventDefault();
      if (!shouldProcessZoomWheel(lastPlainWheelAtRef.current, now, SCROLL_ZOOM_GAP_MS)) {
        accumulatedDeltaRef.current = 0;
        return;
      }

      // Accumulate deltaY (negative deltaY = pinch outward / zoom in, positive = pinch inward / zoom out)
      accumulatedDeltaRef.current += normalizeDelta(e.deltaY, e.deltaMode);

      const { steps, remainder } = consumeDeltaSteps(
        accumulatedDeltaRef.current,
        WHEEL_SENSITIVITY,
      );
      accumulatedDeltaRef.current = remainder;
      if (steps === 0) return;

      // Determine context under cursor
      const targetEl = e.target instanceof Element ? e.target : null;
      const rawCtx =
        resolveContextKey(targetEl?.closest<HTMLElement>('[data-font-ctx]')?.dataset.fontCtx) ??
        'ui';

      applyZoom(-steps, rawCtx);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const action = keyboardStepFor({ key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey });
      if (action === null) return;

      e.preventDefault();

      if (action === 0) {
        resetAll();
        return;
      }

      applyZoom(action, lastContextRef.current);
    };

    const onZoomRequest = (steps: number) => {
      if (steps === 0) {
        resetAll();
        return;
      }
      applyZoom(steps, lastContextRef.current);
    };

    zoomListeners.push(onZoomRequest);

    document.addEventListener('wheel', onWheel, { passive: false });
    document.addEventListener('keydown', onKeyDown);

    return () => {
      zoomListeners = zoomListeners.filter((listener) => listener !== onZoomRequest);
      document.removeEventListener('wheel', onWheel);
      document.removeEventListener('keydown', onKeyDown);
      clearTimeout(hideTimerId);
    };
  }, []);

  return indicator;
}
