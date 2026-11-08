import { createContext, use, useEffect, useState, useMemo } from 'react';
import {
  useThemePreferences,
  type ThemeMode,
  persistResolvedTheme,
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
  return prefersDark ? darkTheme : lightTheme;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { themeMode, lightTheme, darkTheme, setTheme, setThemeMode, setLightTheme, setDarkTheme } =
    useThemePreferences();

  const [prefersDark, setPrefersDark] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

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

  useEffect(() => {
    const root = window.document.documentElement;
    persistResolvedTheme(resolvedTheme);
    const current = root.getAttribute('data-theme');
    if (current) root.classList.remove(current);
    root.setAttribute('data-theme', resolvedTheme);
    root.classList.add(resolvedTheme);
  }, [resolvedTheme]);

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
