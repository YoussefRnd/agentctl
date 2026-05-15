import { z } from 'zod';

export const envSchema = z.object({
  AGENTCTL_SECRET: z.string().min(1).default('dev-secret'),
  AGENTCTL_SESSION_SALT: z.string().min(16).default('dev-session-salt-16-chars'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().optional().default('sqlite.db'),
});

// Used primarily by server
export const parseEnv = (env: Record<string, string | undefined>) => envSchema.parse(env);

// For the frontend, Vite exposes VITE_* prefixed vars
export const webEnvSchema = z.object({
  VITE_AGENTCTL_SECRET: z.string().min(1).default('dev-secret'),
  VITE_API_URL: z.string().startsWith('http').default('http://localhost:3000'),
});

export const parseWebEnv = (env: Record<string, string | undefined>) => webEnvSchema.parse(env);
