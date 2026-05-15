import { z } from 'zod';

export const driverSchema = z.enum(['claude-code', 'gemini-cli', 'opencode', 'codex-acp']);
export const thinkingEffortSchema = z.enum(['low', 'medium', 'high']);

export const projectSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
});

export const createProjectSchema = z.object({
  path: z.string().min(1),
  selectedDriver: driverSchema,
});

export const projectCreatedResponseSchema = z.object({
  project: projectSchema.extend({ id: z.uuid() }),
  sessionId: z.uuid(),
});

export const createSessionSchema = z.object({
  projectId: z.uuid(),
  agent: driverSchema,
});

export const sessionSchema = createSessionSchema.extend({
  branch: z.string().min(1),
  taskSlug: z.string().min(1),
  title: z.string().min(1),
  baseCommit: z.string().min(1),
});

export const sessionProviderSelectionSchema = z.object({
  selectedDriver: driverSchema,
  selectedModel: z.string().min(1),
  selectedThinkingEffort: thinkingEffortSchema,
});

export const driverCapabilitySchema = z.object({
  driver: driverSchema,
  label: z.string().min(1),
  command: z.string().min(1),
  models: z.array(z.string().min(1)),
  thinkingEfforts: z.array(thinkingEffortSchema),
});

export const sessionRowSchema = sessionSchema.extend({
  id: z.uuid(),
  worktreePath: z.string().min(1),
  agentSessionId: z.string().nullable(),
  status: z.enum(['running', 'needs_attention', 'idle', 'error', 'merged', 'discarded']),
  totalTokens: z.number(),
  contextLimit: z.number(),
  estimatedCost: z.number(),
  lastHeartbeat: z.coerce.date().nullable(),
  closedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  selectedDriver: driverSchema,
  selectedModel: z.string().min(1),
  selectedThinkingEffort: thinkingEffortSchema,
});

export const driverStatusSchema = z.enum(['ready', 'not_found', 'error']);

export const acpConfigOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  type: z.literal('select'),
  currentValue: z.string(),
  options: z.array(z.object({
    value: z.string(),
    name: z.string(),
    description: z.string().optional(),
  })),
});

export const driverDiscoverySchema = z.object({
  id: z.string(),
  label: z.string(),
  status: driverStatusSchema,
  command: z.string(),
  configOptions: z.array(acpConfigOptionSchema).optional(),
});

export const sessionWithCapabilitiesSchema = z.object({
  session: sessionRowSchema,
  capabilities: z.array(driverDiscoverySchema),
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
  type: z.enum(['tool_call', 'text', 'diff', 'status', 'compact', 'approval_request']),
  data: z.unknown(),
  createdAt: z.coerce.date(),
});

export type Project = z.infer<typeof projectSchema>;
export type DriverName = z.infer<typeof driverSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type SessionRow = z.infer<typeof sessionRowSchema>;
export type SessionProviderSelection = z.infer<typeof sessionProviderSelectionSchema>;
export type DriverCapability = z.infer<typeof driverCapabilitySchema>;
export type ThinkingEffort = z.infer<typeof thinkingEffortSchema>;
export type SessionWithCapabilities = z.infer<typeof sessionWithCapabilitiesSchema>;
export type SessionStatus = z.infer<typeof sessionStatusSchema>;
export type ACPEvent = z.infer<typeof acpEventSchema>;
export type DriverStatus = z.infer<typeof driverStatusSchema>;
export type ACPConfigOption = z.infer<typeof acpConfigOptionSchema>;
export type DriverDiscovery = z.infer<typeof driverDiscoverySchema>;

export interface ACPEventRow extends Omit<ACPEvent, 'createdAt'> {
  id: number;
  sessionId: string;
  createdAt: Date;
}
