import { z } from 'zod';

export const projectSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
});

export const sessionSchema = z.object({
  projectId: z.string().uuid(),
  branch: z.string().min(1),
  agent: z.enum(['claude-code', 'gemini-cli', 'opencode', 'codex-acp']),
});
