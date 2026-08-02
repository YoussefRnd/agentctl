export interface FontContextConfig {
  family: string;
  size: number;
}

export interface FontConfig {
  ui: FontContextConfig;
  buffer: FontContextConfig;
  terminal: FontContextConfig;
  chat: FontContextConfig;
}

export const DEFAULT_FONT_CONFIG: FontConfig = {
  ui: { family: 'Geist', size: 13 },
  buffer: { family: 'JetBrains Mono', size: 13 },
  terminal: { family: 'JetBrains Mono', size: 12 },
  chat: { family: 'JetBrains Mono', size: 13 },
};

export function isValidFontSize(size: unknown): size is number {
  return typeof size === 'number' && Number.isInteger(size) && size >= 8 && size <= 72;
}
