import { z } from 'zod';
import { settingsResponseSchema, patchSettingsSchema } from '../schemas/settings.js';
export * from '../schemas/settings.js';
export const settingsContract = {
  getSettings: {
    method: 'GET',
    path: '/api/settings',
    responses: {
      200: settingsResponseSchema,
    },
    summary: 'Get system settings',
  },
  patchSettings: {
    method: 'PATCH',
    path: '/api/settings',
    body: patchSettingsSchema,
    responses: {
      200: settingsResponseSchema,
      400: z.object({ message: z.string() }),
    },
    summary: 'Update system settings',
  },
} as const;
