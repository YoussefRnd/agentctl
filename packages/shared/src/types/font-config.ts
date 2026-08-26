export interface FontContextConfig {
  family: string;
  size: number;
}

export interface FontConfig {
  ui: FontContextConfig; // UI chrome and chat prose (Default: Geist 13px)
  code: FontContextConfig; // Code editor diffs, blocks, and terminal (Default: JetBrains Mono 13px)
}

export const DEFAULT_FONT_CONFIG: FontConfig = {
  ui: { family: 'Geist', size: 13 },
  code: { family: 'JetBrains Mono', size: 13 },
};

export function isValidFontSize(size: unknown): size is number {
  return typeof size === 'number' && Number.isInteger(size) && size >= 8 && size <= 72;
}
