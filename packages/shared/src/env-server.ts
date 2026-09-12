import { z } from 'zod';

export const serverEnvSchema = z.object({
  AGENTCTL_SECRET: z.string().min(1).default('dev-secret'),
  AGENTCTL_SESSION_KEY: z.string().min(32).default('dev-session-key-dev-session-key-123456'),
  AGENTCTL_SESSION_SALT: z.string().length(16).default('dev-session-salt'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().optional().default('sqlite.db'),
  CORS_ALLOWED_ORIGINS: z.string().optional(),
  AGENTCTL_WORKSPACE_SEARCH_PATHS: z.string().optional(),
  AGENTCTL_SESSION_MAX_AGE_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(24 * 60 * 60),
  AGENTCTL_PAIRED_SESSION_MAX_AGE_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(30 * 24 * 60 * 60),
  AGENTCTL_EDITOR_CACHE_MS: z.coerce.number().int().positive().default(60_000),
});

export const parseServerEnv = (env: Record<string, string | undefined>) =>
  serverEnvSchema.parse(env);
