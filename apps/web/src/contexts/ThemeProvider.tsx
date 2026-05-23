import { createContext, useContext, useEffect, useState } from 'react';

type Theme = string;

interface ThemeContextType {
 theme: Theme;
 setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({
 children,
 defaultTheme = 'oled-glass',
 storageKey = 'agentctl-ui-theme',
}: {
 children: React.ReactNode;
 defaultTheme?: Theme;
 storageKey?: string;
}) {
 const [theme, setTheme] = useState<Theme>(() => localStorage.getItem(storageKey) ?? defaultTheme);

 useEffect(() => {
  const root = window.document.documentElement;

  // Remove old theme
  const currentTheme = root.getAttribute('data-theme');
  if (currentTheme) {
   root.classList.remove(currentTheme);
  }

  // Apply new theme
  root.setAttribute('data-theme', theme);
  // Also add class to root for tailwind to pick up if it relies on classes
  root.classList.add(theme);

  localStorage.setItem(storageKey, theme);
 }, [theme, storageKey]);

 return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => {
 const context = useContext(ThemeContext);
 if (context === undefined) {
  throw new Error('useTheme must be used within a ThemeProvider');
 }
 return context;
};
