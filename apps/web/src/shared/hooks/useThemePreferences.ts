import { useCallback, useEffect, useState } from 'react';
import { browserStorage } from '../lib/persistentStorage';
import { isLightTheme } from '../lib/theme-registry';

export type ThemeMode = 'light' | 'dark' | 'system';

const MODE_KEY = 'agentctl-ui-theme-mode';
const LIGHT_KEY = 'agentctl-ui-light-theme';
const DARK_KEY = 'agentctl-ui-dark-theme';
const LEGACY_KEY = 'agentctl-ui-theme';

interface ThemePreferences {
  themeMode: ThemeMode;
  lightTheme: string;
  darkTheme: string;
}

function normalizeTheme(theme: string): string {
  return theme === 'oled-glass' ? 'mocha' : theme;
}

function readTheme(key: string): string | null {
  const stored = browserStorage.getItem(key);
  return stored === null ? null : normalizeTheme(stored);
}

function loadPreferences(): ThemePreferences {
  const legacy = readTheme(LEGACY_KEY);
  const legacyMode = legacy === null ? 'system' : isLightTheme(legacy) ? 'light' : 'dark';
  const savedMode = browserStorage.getItem(MODE_KEY);
  const themeMode =
    savedMode === 'light' || savedMode === 'dark' || savedMode === 'system'
      ? savedMode
      : legacyMode;
  return {
    themeMode,
    lightTheme: readTheme(LIGHT_KEY) ?? (legacyMode === 'light' ? legacy : null) ?? 'latte',
    darkTheme: readTheme(DARK_KEY) ?? (legacyMode === 'dark' ? legacy : null) ?? 'mocha',
  };
}

export function persistResolvedTheme(theme: string) {
  // Older releases read the resolved theme when users switch back to them.
  browserStorage.setItem(LEGACY_KEY, theme);
}

export function useThemePreferences() {
  const [preferences, setPreferences] = useState(loadPreferences);

  useEffect(() => {
    browserStorage.setItem(MODE_KEY, preferences.themeMode);
    browserStorage.setItem(LIGHT_KEY, preferences.lightTheme);
    browserStorage.setItem(DARK_KEY, preferences.darkTheme);
  }, [preferences]);

  const setThemeMode = useCallback((themeMode: ThemeMode) => {
    setPreferences((previous) => ({ ...previous, themeMode }));
  }, []);

  const setLightTheme = useCallback((theme: string) => {
    const lightTheme = normalizeTheme(theme);
    setPreferences((previous) => ({ ...previous, lightTheme }));
  }, []);

  const setDarkTheme = useCallback((theme: string) => {
    const darkTheme = normalizeTheme(theme);
    setPreferences((previous) => ({ ...previous, darkTheme }));
  }, []);

  const setTheme = useCallback((name: string) => {
    const theme = normalizeTheme(name);
    setPreferences((previous) =>
      isLightTheme(theme)
        ? { ...previous, themeMode: 'light', lightTheme: theme }
        : { ...previous, themeMode: 'dark', darkTheme: theme },
    );
  }, []);

  return { ...preferences, setThemeMode, setLightTheme, setDarkTheme, setTheme };
}
