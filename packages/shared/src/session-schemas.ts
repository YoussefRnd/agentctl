import { z } from 'zod';

export const providerSchema = z.enum(['claude-acp', 'opencode', 'codex-acp', 'gemini']);

export const sessionModeSchema = z.enum(['worktree', 'local']);

export const thinkingEffortSchema = z.enum(['low', 'medium', 'high']);

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

export const createSessionSchema = z.object({
  projectId: z.uuid(),
  agent: providerSchema,
  mode: sessionModeSchema.optional(),
});

export const sessionSchema = createSessionSchema.extend({
  branch: z.string().min(1),
  taskSlug: z.string().min(1),
  title: z.string().min(1),
  baseCommit: z.string().min(1),
});

export const sessionProviderSelectionSchema = z.object({
  selectedProvider: providerSchema,
  selectedModel: z.string().min(1),
  selectedThinkingEffort: thinkingEffortSchema,
});

export const providerStatusSchema = z.enum([
  'ready',
  'not_found',
  'error',
  'needs_auth',
  'inactive',
]);

export const acpConfigOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  type: z.literal('select'),
  currentValue: z.string(),
  options: z.array(
    z.object({
      value: z.string(),
      name: z.string(),
      description: z.string().optional(),
    }),
  ),
});

export const providerCapabilitySchema = z.object({
  id: z.string(),
  label: z.string(),
  status: providerStatusSchema,
  command: z.string(),
  configOptions: z.array(acpConfigOptionSchema).optional(),
  version: z.string().optional(),
  description: z.string().optional(),
  icon: z.string().optional(),
  supportsDynamicModel: z.boolean().optional(),
  supportsDynamicConfig: z.boolean().optional(),
});

export const authMethodSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  _meta: z.record(z.string(), z.any()).nullable().optional(),
});

export const providerDiscoverySchema = z.object({
  id: z.string(),
  label: z.string(),
  status: providerStatusSchema,
  command: z.string(),
  enabled: z.boolean().default(false),
  launchArgs: z.array(z.string()).optional().default([]),
  launchEnv: z.record(z.string(), z.string()).optional().default({}),
  customEnv: z.record(z.string(), z.string()).optional().default({}),
  configOptions: z.array(acpConfigOptionSchema).optional(),
  authMethods: z.array(authMethodSchema).optional().default([]),
  version: z.string().optional(),
  description: z.string().optional(),
  icon: z.string().optional(),
  supportsDynamicModel: z.boolean().optional().default(false),
  supportsDynamicConfig: z.boolean().optional().default(false),
});

export const PROVIDER_ENV_KEYS: Record<string, string[] | undefined> = {
  'claude-acp': ['ANTHROPIC_API_KEY'],
  gemini: ['GEMINI_API_KEY'],
  'codex-acp': ['OPENAI_API_KEY'],
};

export const sessionRowSchema = sessionSchema.extend({
  id: z.uuid(),
  worktreePath: z.string().min(1),
  agentSessionId: z.string().nullable(),
  status: z.enum(['running', 'needs_attention', 'idle', 'error', 'merged', 'discarded', 'archived']),
  mode: sessionModeSchema.default('local'),
  totalTokens: z.number(),
  contextLimit: z.number(),
  estimatedCost: z.number(),
  lastHeartbeat: z.coerce.date().nullable(),
  closedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  selectedProvider: providerSchema,
  selectedModel: z.string().min(1),
  selectedThinkingEffort: thinkingEffortSchema,
  project: projectSchema.optional(),
});

export const sessionWithCapabilitiesSchema = z.object({
  session: sessionRowSchema,
  capabilities: z.array(providerCapabilitySchema),
});

export const sessionStatusSchema = z.enum([
  'running',
  'needs_attention',
  'idle',
  'error',
  'merged',
  'discarded',
  'archived',
]);

export type Project = z.infer<typeof projectSchema>;
export type ProviderName = z.infer<typeof providerSchema>;
export type SessionMode = z.infer<typeof sessionModeSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type SessionRow = z.infer<typeof sessionRowSchema>;
export type SessionProviderSelection = z.infer<typeof sessionProviderSelectionSchema>;
export type ProviderCapability = z.infer<typeof providerCapabilitySchema>;
export type ThinkingEffort = z.infer<typeof thinkingEffortSchema>;
export type SessionWithCapabilities = z.infer<typeof sessionWithCapabilitiesSchema>;
export type SessionStatus = z.infer<typeof sessionStatusSchema>;
export type ProviderStatus = z.infer<typeof providerStatusSchema>;
export type ACPConfigOption = z.infer<typeof acpConfigOptionSchema>;
export type ProviderDiscovery = z.infer<typeof providerDiscoverySchema>;
export type AuthMethod = z.infer<typeof authMethodSchema>;
