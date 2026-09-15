import { useEffect, useRef, useState } from 'react';
import { DEFAULT_FONT_CONFIG, type FontConfig } from '@agentctl/shared';
import {
  clampZoom,
  keyboardStepFor,
  ZOOM_DEFAULT,
  ZOOM_STEP,
  type FontContextKey,
} from './fontZoomLogic';
import { useSettings } from '@/features/settings';

const INDICATOR_DURATION = 1400;

export interface ZoomIndicatorState {
  context: FontContextKey;
  size: number;
  visible: boolean;
}

const HIDDEN_INDICATOR: ZoomIndicatorState = { context: 'window', size: 100, visible: false };

function readInitialWindowZoom(): number {
  try {
    const saved = localStorage.getItem('agentctl:window-zoom');
    return saved ? clampZoom(parseInt(saved, 10)) : ZOOM_DEFAULT;
  } catch {
    return ZOOM_DEFAULT;
  }
}

/**
 * Global Keyboard Window Zoom & Reset Hook.
 *
 * `Ctrl/Cmd + =` / `+`: Zoom In (+5%)
 * `Ctrl/Cmd + -`: Zoom Out (-5%)
 * `Ctrl/Cmd + 0`: Reset zoom (100%) and font settings
 */
export function useFontZoom(): ZoomIndicatorState {
  const { settings, updateSettings } = useSettings();
  const [indicator, setIndicator] = useState<ZoomIndicatorState>(HIDDEN_INDICATOR);

  const fontConfigRef = useRef<FontConfig | undefined>(settings?.fontConfig);
  const updateSettingsRef = useRef(updateSettings);
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
      root.style.setProperty('--font-mono-size', `${String(fontConfig.code.size)}px`);
      root.style.setProperty('--font-buffer-size', `${String(fontConfig.code.size)}px`);
      root.style.setProperty('--font-terminal-size', `${String(fontConfig.code.size)}px`);
      root.style.setProperty('--font-chat-size', `${String(fontConfig.ui.size)}px`);
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

      const next: FontConfig = {
        ui: {
          family: fontConfigRef.current?.ui.family ?? DEFAULT_FONT_CONFIG.ui.family,
          size: DEFAULT_FONT_CONFIG.ui.size,
        },
        code: {
          family: fontConfigRef.current?.code.family ?? DEFAULT_FONT_CONFIG.code.family,
          size: DEFAULT_FONT_CONFIG.code.size,
        },
      };

      fontConfigRef.current = next;
      applyCssVars(next);
      showIndicator('window', 100);
      void updateSettingsRef.current({ fontConfig: next });
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

    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      clearTimeout(hideTimerId);
    };
  }, []);

  return indicator;
}
