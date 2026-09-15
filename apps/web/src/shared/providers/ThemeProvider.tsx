import { createContext, use, useEffect, useState, useMemo, useCallback } from 'react';
import {
  useThemePreferences,
  type ThemeMode,
  isLightTheme,
  LEGACY_KEY,
} from '../hooks/useThemePreferences';

type Theme = string;

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  lightTheme: string;
  darkTheme: string;
  setLightTheme: (theme: string) => void;
  setDarkTheme: (theme: string) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

function resolveTheme(
  mode: ThemeMode,
  lightTheme: string,
  darkTheme: string,
  prefersDark: boolean,
): string {
  if (mode === 'light') return lightTheme;
  if (mode === 'dark') return darkTheme;
  // system
  return prefersDark ? darkTheme : lightTheme;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { themeMode, lightTheme, darkTheme, setThemeMode, setLightTheme, setDarkTheme } =
    useThemePreferences();

  const [prefersDark, setPrefersDark] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  // Listen to OS theme changes
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      setPrefersDark(e.matches);
    };
    mq.addEventListener('change', handler);
    return () => {
      mq.removeEventListener('change', handler);
    };
  }, []);

  const resolvedTheme = useMemo(
    () => resolveTheme(themeMode, lightTheme, darkTheme, prefersDark),
    [themeMode, lightTheme, darkTheme, prefersDark],
  );

  // Apply theme to DOM
  useEffect(() => {
    const root = window.document.documentElement;
    const effective = resolvedTheme === 'oled-glass' ? 'mocha' : resolvedTheme;

    // Write resolved theme to legacy key for backward compat
    localStorage.setItem(LEGACY_KEY, resolvedTheme);

    // Remove old theme classes
    const current = root.getAttribute('data-theme');
    if (current) root.classList.remove(current);

    // Apply new theme
    root.setAttribute('data-theme', effective);
    root.classList.add(effective);
  }, [resolvedTheme]);

  // setTheme override: clicking a theme in Theme tab sets mode + appropriate theme
  const setTheme = useCallback(
    (theme: Theme) => {
      const isLight = isLightTheme(theme);
      if (isLight) {
        setThemeMode('light');
        setLightTheme(theme);
      } else {
        setThemeMode('dark');
        setDarkTheme(theme);
      }
    },
    [setThemeMode, setLightTheme, setDarkTheme],
  );

  const contextValue = useMemo(
    () => ({
      theme: resolvedTheme,
      setTheme,
      themeMode,
      setThemeMode,
      lightTheme,
      darkTheme,
      setLightTheme,
      setDarkTheme,
    }),
    [
      resolvedTheme,
      setTheme,
      themeMode,
      setThemeMode,
      lightTheme,
      darkTheme,
      setLightTheme,
      setDarkTheme,
    ],
  );

  return <ThemeContext.Provider value={contextValue}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => {
  const context = use(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
