import { useState, useCallback } from 'react';
import { isLightTheme } from '../shared/lib/theme-registry';

export type ThemeMode = 'light' | 'dark' | 'system';

const MODE_KEY = 'agentctl-ui-theme-mode';
const LIGHT_KEY = 'agentctl-ui-light-theme';
const DARK_KEY = 'agentctl-ui-dark-theme';
const LEGACY_KEY = 'agentctl-ui-theme';

function readKey(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeKey(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage unavailable — silently fail
  }
}

export interface ThemePreferences {
  themeMode: ThemeMode;
  lightTheme: string;
  darkTheme: string;
  setThemeMode: (mode: ThemeMode) => void;
  setLightTheme: (theme: string) => void;
  setDarkTheme: (theme: string) => void;
}

function migrateLegacyIfNeeded() {
  try {
    const hasNewKeys =
      localStorage.getItem(MODE_KEY) !== null &&
      localStorage.getItem(LIGHT_KEY) !== null &&
      localStorage.getItem(DARK_KEY) !== null;
    if (hasNewKeys) return;

    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy === null) return;

    // oled-glass maps to mocha
    const resolved = legacy === 'oled-glass' ? 'mocha' : legacy;
    const isLight = isLightTheme(resolved);

    if (isLight) {
      localStorage.setItem(MODE_KEY, 'light');
      localStorage.setItem(LIGHT_KEY, resolved);
      localStorage.setItem(DARK_KEY, 'mocha');
    } else {
      localStorage.setItem(MODE_KEY, 'dark');
      localStorage.setItem(DARK_KEY, resolved);
      localStorage.setItem(LIGHT_KEY, 'latte');
    }
  } catch {
    // storage unavailable
  }
}

export function useThemePreferences(): ThemePreferences {
  // Migrate synchronously before state is initialized so initial state callback reads the new keys
  migrateLegacyIfNeeded();

  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => {
    return readKey(MODE_KEY, 'system') as ThemeMode;
  });
  const [lightTheme, setLightThemeState] = useState<string>(() => {
    return readKey(LIGHT_KEY, 'latte');
  });
  const [darkTheme, setDarkThemeState] = useState<string>(() => {
    return readKey(DARK_KEY, 'mocha');
  });

  const setThemeMode = useCallback((mode: ThemeMode) => {
    setThemeModeState(mode);
    writeKey(MODE_KEY, mode);
  }, []);

  const setLightTheme = useCallback((theme: string) => {
    setLightThemeState(theme);
    writeKey(LIGHT_KEY, theme);
  }, []);

  const setDarkTheme = useCallback((theme: string) => {
    setDarkThemeState(theme);
    writeKey(DARK_KEY, theme);
  }, []);

  return { themeMode, lightTheme, darkTheme, setThemeMode, setLightTheme, setDarkTheme };
}

export { isLightTheme, LEGACY_KEY };
