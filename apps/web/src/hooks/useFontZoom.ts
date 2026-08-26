import { useEffect, useRef, useState } from 'react';
import { DEFAULT_FONT_CONFIG, type FontConfig } from '@agentctl/shared';
import {
  clampSize,
  clampZoom,
  consumeDeltaSteps,
  keyboardStepFor,
  normalizeDelta,
  resolveContextKey,
  resolveTargetContexts,
  shouldProcessZoomWheel,
  ZOOM_DEFAULT,
  ZOOM_STEP,
  type FontContextKey,
} from './fontZoomLogic';
import { useSettings } from './useSettings';

const INDICATOR_DURATION = 1500;
const WHEEL_SENSITIVITY = 40; // Pixels of pinch delta required for 1px font size change
const SCROLL_ZOOM_GAP_MS = 150; // Plain scroll within this window kills a ctrl+wheel zoom burst
const PERSIST_DEBOUNCE_MS = 500; // Debounce server settings PATCH during active pinch gestures

export interface ZoomIndicatorState {
  context: FontContextKey;
  size: number;
  visible: boolean;
}

const HIDDEN_INDICATOR: ZoomIndicatorState = { context: 'ui', size: 0, visible: false };

/**
 * Trackpad Pinch & Global Window Zoom Hook.
 *
 * 1. Global Window Zoom (`Ctrl/Cmd + = / - / 0`):
 *    - Adjusts whole application window zoom percentage (e.g. 100%, 110%, 120%)
 *    - Persisted in localStorage (`agentctl:window-zoom`) and applies to root document style.
 *
 * 2. Contextual Font Zoom (`Ctrl/Cmd + Mouse Wheel` / `Trackpad Pinch`):
 *    - Detects hovered pane (`chat`, `terminal`, `buffer`, `ui`)
 *    - Immediately applies CSS variables to documentElement for 60/120fps smooth responsiveness
 *    - Debounces server settings persistence by 500ms to eliminate network flood
 */
function readInitialWindowZoom(): number {
  try {
    const saved = localStorage.getItem('agentctl:window-zoom');
    return saved ? clampZoom(parseInt(saved, 10)) : ZOOM_DEFAULT;
  } catch {
    return ZOOM_DEFAULT;
  }
}

export function useFontZoom(): ZoomIndicatorState {
  const { settings, updateSettings } = useSettings();
  const [indicator, setIndicator] = useState<ZoomIndicatorState>(HIDDEN_INDICATOR);
  const accumulatedDeltaRef = useRef<number>(0);
  const lastPlainWheelAtRef = useRef<number | null>(null);

  const fontConfigRef = useRef<FontConfig | undefined>(settings?.fontConfig);
  const updateSettingsRef = useRef(updateSettings);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const windowZoomRef = useRef<number>(readInitialWindowZoom());

  useEffect(() => {
    fontConfigRef.current = settings?.fontConfig;
  }, [settings?.fontConfig]);

  useEffect(() => {
    updateSettingsRef.current = updateSettings;
  }, [updateSettings]);

  // Apply initial saved window zoom on mount
  useEffect(() => {
    const zoom = readInitialWindowZoom();
    if (zoom !== 100) {
      document.documentElement.style.setProperty('--app-zoom', `${String(zoom)}%`);
      (document.documentElement.style as unknown as { zoom?: string }).zoom = `${String(zoom)}%`;
    }
  }, []);

  useEffect(() => {
    let hideTimerId: ReturnType<typeof setTimeout> | undefined;

    const showIndicator = (context: FontContextKey, size: number) => {
      setIndicator({ context, size, visible: true });
      clearTimeout(hideTimerId);
      hideTimerId = setTimeout(() => {
        setIndicator((prev) => ({ ...prev, visible: false }));
      }, INDICATOR_DURATION);
    };

    const applyCssVars = (fontConfig: FontConfig) => {
      const root = document.documentElement;
      root.style.setProperty('--font-ui-size', `${String(fontConfig.ui.size)}px`);
      root.style.setProperty('--font-buffer-size', `${String(fontConfig.buffer.size)}px`);
      root.style.setProperty('--font-terminal-size', `${String(fontConfig.terminal.size)}px`);
      root.style.setProperty('--font-chat-size', `${String(fontConfig.chat.size)}px`);
    };

    const debouncedPersist = (fontConfig: FontConfig) => {
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = setTimeout(() => {
        void updateSettingsRef.current({ fontConfig });
      }, PERSIST_DEBOUNCE_MS);
    };

    const applyPaneFontZoom = (steps: number, rawCtx: FontContextKey) => {
      const base = fontConfigRef.current ?? DEFAULT_FONT_CONFIG;
      const targets = resolveTargetContexts(rawCtx);
      if (targets.length === 0) return;

      const next: FontConfig = { ...base };
      for (const ctx of targets) {
        const currentTarget = base[ctx];
        next[ctx] = { ...currentTarget, size: clampSize(currentTarget.size + steps) };
      }

      fontConfigRef.current = next;
      applyCssVars(next);
      const primaryTarget = targets[0];
      showIndicator(rawCtx, next[primaryTarget].size);
      debouncedPersist(next);
    };

    const applyWindowZoom = (deltaSteps: number) => {
      const current = windowZoomRef.current;
      const nextZoom = clampZoom(current + deltaSteps * ZOOM_STEP);
      windowZoomRef.current = nextZoom;

      try {
        localStorage.setItem('agentctl:window-zoom', String(nextZoom));
      } catch {
        // ignore
      }

      document.documentElement.style.setProperty('--app-zoom', `${String(nextZoom)}%`);
      (document.documentElement.style as unknown as { zoom?: string }).zoom =
        `${String(nextZoom)}%`;

      showIndicator('window', nextZoom);
    };

    const resetWindowAndFonts = () => {
      windowZoomRef.current = ZOOM_DEFAULT;
      try {
        localStorage.setItem('agentctl:window-zoom', String(ZOOM_DEFAULT));
      } catch {
        // ignore
      }

      document.documentElement.style.setProperty('--app-zoom', '100%');
      (document.documentElement.style as unknown as { zoom?: string }).zoom = '100%';

      const base = fontConfigRef.current;
      const next: FontConfig = base
        ? {
            ui: { family: base.ui.family, size: DEFAULT_FONT_CONFIG.ui.size },
            buffer: { family: base.buffer.family, size: DEFAULT_FONT_CONFIG.buffer.size },
            terminal: { family: base.terminal.family, size: DEFAULT_FONT_CONFIG.terminal.size },
            chat: { family: base.chat.family, size: DEFAULT_FONT_CONFIG.chat.size },
          }
        : DEFAULT_FONT_CONFIG;

      fontConfigRef.current = next;
      applyCssVars(next);
      showIndicator('window', 100);
      void updateSettingsRef.current({ fontConfig: next });
    };

    const onWheel = (e: WheelEvent) => {
      const now = performance.now();
      const isZoomModifier = e.ctrlKey || e.metaKey;

      // Plain 2-finger trackpad scrolling (ctrlKey = false) is ignored
      if (!isZoomModifier) {
        lastPlainWheelAtRef.current = now;
        accumulatedDeltaRef.current = 0;
        return;
      }

      e.preventDefault();
      if (!shouldProcessZoomWheel(lastPlainWheelAtRef.current, now, SCROLL_ZOOM_GAP_MS)) {
        accumulatedDeltaRef.current = 0;
        return;
      }

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
        'chat';

      applyPaneFontZoom(-steps, rawCtx);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const action = keyboardStepFor({ key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey });
      if (action === null) return;

      e.preventDefault();

      if (action === 0) {
        resetWindowAndFonts();
        return;
      }

      applyWindowZoom(action);
    };

    document.addEventListener('wheel', onWheel, { passive: false });
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('wheel', onWheel);
      document.removeEventListener('keydown', onKeyDown);
      clearTimeout(hideTimerId);
      clearTimeout(persistTimerRef.current);
    };
  }, []);

  return indicator;
}
