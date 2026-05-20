import { z } from 'zod';

export const webEnvSchema = z.object({
  VITE_API_URL: z.string().startsWith('http').default('http://localhost:3000'),
});

export const parseWebEnv = (env: Record<string, string | undefined>) => webEnvSchema.parse(env);
