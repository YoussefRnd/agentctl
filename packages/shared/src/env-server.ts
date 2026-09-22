import { z } from 'zod';

export const DEVELOPMENT_SESSION_KEY = 'dev-session-key-dev-session-key-123456';
export const DEVELOPMENT_SESSION_SALT = 'dev-session-salt';

export const serverEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    AGENTCTL_SESSION_KEY: z.string().min(32).default(DEVELOPMENT_SESSION_KEY),
    AGENTCTL_SESSION_SALT: z.string().length(16).default(DEVELOPMENT_SESSION_SALT),
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
  })
  .superRefine((env, context) => {
    if (env.NODE_ENV !== 'production') return;
    if (env.AGENTCTL_SESSION_KEY === DEVELOPMENT_SESSION_KEY) {
      context.addIssue({
        code: 'custom',
        path: ['AGENTCTL_SESSION_KEY'],
        message: 'AGENTCTL_SESSION_KEY must be replaced in production',
      });
    }
    if (env.AGENTCTL_SESSION_SALT === DEVELOPMENT_SESSION_SALT) {
      context.addIssue({
        code: 'custom',
        path: ['AGENTCTL_SESSION_SALT'],
        message: 'AGENTCTL_SESSION_SALT must be replaced in production',
      });
    }
  });

export const parseServerEnv = (env: Record<string, string | undefined>) =>
  serverEnvSchema.parse(env);
