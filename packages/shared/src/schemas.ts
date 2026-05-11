import { z } from 'zod';

export const projectSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
});

export const createSessionSchema = z.object({
  projectId: z.uuid(),
  agent: z.enum(['claude-code', 'gemini-cli', 'opencode', 'codex-acp']),
});

export const sessionSchema = createSessionSchema.extend({
  branch: z.string().min(1),
  taskSlug: z.string().min(1),
  baseCommit: z.string().min(1),
});

export const sessionStatusSchema = z.enum([
  'running',
  'needs_attention',
  'idle',
  'error',
  'merged',
  'discarded',
]);

/**
 * ACP Event Schema
 * Note: 'compact' is a special event type used by agentctl to capture 
 * the native agent summarization output during handoffs between sessions.
 */
export const acpEventSchema = z.object({
  type: z.enum(['tool_call', 'text', 'diff', 'status', 'compact']),
  data: z.unknown(),
  createdAt: z.coerce.date(),
});

export type Project = z.infer<typeof projectSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type SessionStatus = z.infer<typeof sessionStatusSchema>;
export type ACPEvent = z.infer<typeof acpEventSchema>;
