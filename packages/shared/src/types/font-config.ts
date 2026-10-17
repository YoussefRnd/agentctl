import type { z } from 'zod';
import type { fontContextSchema, settingsResponseSchema } from '../schemas/settings.js';
export type FontContextConfig = z.infer<typeof fontContextSchema>;
export type FontConfig = z.infer<typeof settingsResponseSchema>['fontConfig'];

export const DEFAULT_FONT_CONFIG: FontConfig = {
  ui: { family: 'Geist', size: 13 },
  code: { family: 'JetBrains Mono', size: 13 },
};

export function isValidFontSize(size: unknown): size is number {
  return typeof size === 'number' && Number.isInteger(size) && size >= 8 && size <= 72;
}
