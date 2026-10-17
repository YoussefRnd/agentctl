import { z } from 'zod';
import { providerSchema } from './session-options.js';
export const projectSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  path: z.string().min(1),
  repoRoot: z.string().nullable(),
  subdir: z.string().default(''),
});

export const createProjectSchema = z.object({
  path: z.string().min(1),
  selectedProvider: providerSchema,
});

export const projectCreatedResponseSchema = z.object({
  project: projectSchema.extend({ id: z.uuid() }),
  sessionId: z.uuid(),
});

export type Project = z.infer<typeof projectSchema>;
