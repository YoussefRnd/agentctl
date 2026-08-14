export interface ThemeEntry {
  id: string;
  name: string;
  description: string;
  type: 'light' | 'dark';
  colors: {
    bg: string;
    surface: string;
    text: string;
    accent: string;
  };
}

const THEME_REGISTRY: ThemeEntry[] = [
  {
    id: 'mocha',
    name: 'Mocha',
    description: 'Traditional cozy Catppuccin dark theme',
    type: 'dark',
    colors: { bg: '#11111b', surface: '#1e1e2e', text: '#cdd6f4', accent: '#cba6f7' },
  },
  {
    id: 'macchiato',
    name: 'Macchiato',
    description: 'Warm medium-dark Catppuccin theme',
    type: 'dark',
    colors: { bg: '#181926', surface: '#24273a', text: '#cad3f5', accent: '#8aadf4' },
  },
  {
    id: 'frappe',
    name: 'Frappé',
    description: 'Balanced medium-dark Catppuccin theme',
    type: 'dark',
    colors: { bg: '#232634', surface: '#303446', text: '#c6d0f5', accent: '#ca9ee6' },
  },
  {
    id: 'latte',
    name: 'Latte',
    description: 'Crisp and clean light Catppuccin theme',
    type: 'light',
    colors: { bg: '#dce0e8', surface: '#eff1f5', text: '#4c4f69', accent: '#8839ef' },
  },
];

export function isLightTheme(id: string): boolean {
  const entry = THEME_REGISTRY.find((t) => t.id === id);
  return entry?.type === 'light';
}

export function getLightThemes(): ThemeEntry[] {
  return THEME_REGISTRY.filter((t) => t.type === 'light');
}

export function getDarkThemes(): ThemeEntry[] {
  return THEME_REGISTRY.filter((t) => t.type === 'dark');
}
