import { z } from 'zod';

export const projectSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
});

export const sessionSchema = z.object({
  projectId: z.uuid(),
  branch: z.string().min(1),
  agent: z.enum(['claude-code', 'gemini-cli', 'opencode', 'codex-acp']),
});

export const sessionStatusSchema = z.enum(['running', 'needs_attention', 'idle', 'error']);

export const acpEventSchema = z.object({
  type: z.enum(['tool_call', 'text', 'diff', 'status', 'compact']),
  data: z.unknown(),
  createdAt: z.coerce.date(),
});

export type Project = z.infer<typeof projectSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type SessionStatus = z.infer<typeof sessionStatusSchema>;
export type ACPEvent = z.infer<typeof acpEventSchema>;
