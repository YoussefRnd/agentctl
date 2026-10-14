import { z } from 'zod';

export const fontContextSchema = z.object({
  family: z.string(),
  size: z.number().int().min(8).max(72),
});

export const fontConfigSchema = z.object({
  ui: fontContextSchema.optional(),
  code: fontContextSchema.optional(),
});

export const gitTextGenerationSettingsSchema = z.object({
  providerId: z.string().trim().min(1).max(256),
  modelId: z.string().trim().min(1).max(256).nullable(),
});
export type GitTextGenerationSettings = z.infer<typeof gitTextGenerationSettingsSchema>;

export const patchSettingsSchema = z.object({
  onboardingCompleted: z.boolean().optional(),
  onboardingVersion: z.union([z.string(), z.number()]).optional(),
  setupStep: z.string().nullable().optional(),
  defaultProviderId: z.string().nullable().optional(),
  gitTextGeneration: gitTextGenerationSettingsSchema.nullable().optional(),
  showThinking: z.boolean().optional(),
  defaultToWorktree: z.boolean().optional(),
  registrySyncError: z.string().nullable().optional(),
  fontConfig: fontConfigSchema.optional(),
});

export const settingsResponseSchema = z.object({
  onboardingCompleted: z.boolean(),
  onboardingVersion: z.string(),
  setupStep: z.string().nullable(),
  defaultProviderId: z.string().nullable(),
  gitTextGeneration: gitTextGenerationSettingsSchema.nullable(),
  showThinking: z.boolean(),
  defaultToWorktree: z.boolean(),
  registrySyncError: z.string().nullable().optional(),
  fontConfig: z.object({
    ui: fontContextSchema,
    code: fontContextSchema,
  }),
});

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
