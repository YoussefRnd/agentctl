import { z } from 'zod';

export const envSchema = z.object({
  AGENTCTL_SECRET: z.string().min(1).default('dev-secret'),
  AGENTCTL_SESSION_KEY: z.string().min(32).default('dev-session-key-dev-session-key-123456'),
  AGENTCTL_SESSION_SALT: z.string().length(16).default('dev-session-salt'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().optional().default('sqlite.db'),
});

// Used primarily by server
export const parseEnv = (env: Record<string, string | undefined>) => envSchema.parse(env);

// For the frontend, Vite exposes VITE_* prefixed vars
export const webEnvSchema = z.object({
  VITE_API_URL: z.string().startsWith('http').default('http://localhost:3000'),
});

export const parseWebEnv = (env: Record<string, string | undefined>) => webEnvSchema.parse(env);
