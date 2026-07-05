import { z } from 'zod';

export const providerSchema = z.enum(['claude-acp', 'opencode', 'codex-acp', 'gemini']);

export const sessionModeSchema = z.enum(['worktree', 'local']);

export const approvalModeSchema = z.enum(['review', 'auto_approve', 'yolo']);

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
  agent: providerSchema.optional(),
  mode: sessionModeSchema.optional(),
  taskSlug: z.string().optional(),
});

export const sessionSchema = createSessionSchema.extend({
  branch: z.string().min(1),
  taskSlug: z.string().min(1),
  title: z.string().min(1),
  baseCommit: z.string().min(1),
  baseBranch: z.string().nullable().optional(),
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
  category: z.string().optional(),
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
  modes: z.array(z.string()).optional().default([]),
});

export const authEnvVarSchema = z.object({
  name: z.string(),
  label: z.string().optional(),
  secret: z.boolean().default(true),
  optional: z.boolean().default(false),
});

export const authMethodSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['agent', 'env_var']).optional().default('agent'),
  description: z.string().nullable().optional(),
  vars: z.array(authEnvVarSchema).optional(),
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
  supportsLogout: z.boolean().optional().default(false),
  nativelyLoadsSkills: z.boolean().optional().default(false),
});

export function getProviderEnvKeys(provider: {
  id: string;
  authMethods?: { type?: string; vars?: { name: string }[] }[] | null;
}): string[] {
  const envVarMethod = provider.authMethods?.find((m) => m.type === 'env_var');
  if (envVarMethod?.vars && envVarMethod.vars.length > 0) {
    return envVarMethod.vars.map((v) => v.name);
  }
  return [];
}

export const availableCommandSchema = z.object({
  name: z.string(),
  description: z.string(),
  input: z
    .object({
      hint: z.string(),
    })
    .optional(),
});

export const sessionConfigOptionsSchema = z.array(acpConfigOptionSchema);

export const sessionMetricsSchema = z.object({
  usageBreakdown: z
    .object({
      history: z.number().optional(),
      files: z.number().optional(),
      system: z.number().optional(),
      cache: z.number().optional(),
    })
    .optional(),
  estimatedCost: z.number().optional(),
  cachingEnabled: z.boolean().optional(),
  cacheHitRate: z.number().optional(),
  turnsRemaining: z.number().optional(),
});

export const sessionRowSchema = sessionSchema.extend({
  id: z.uuid(),
  worktreePath: z.string().min(1),
  agentSessionId: z.string().nullable(),
  status: z.enum([
    'running',
    'needs_attention',
    'idle',
    'error',
    'merged',
    'discarded',
    'archived',
  ]),
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
  approvalMode: approvalModeSchema,
  agentPersona: z.string().nullable().default(null),
  availableAgentPersonas: z
    .preprocess((val) => {
      if (typeof val === 'string') {
        try {
          return JSON.parse(val) as unknown;
        } catch {
          return [];
        }
      }
      return val ?? [];
    }, z.array(z.string()))
    .default([]),
  project: projectSchema.optional(),
  availableCommands: z
    .preprocess((val) => {
      if (typeof val === 'string') {
        try {
          return JSON.parse(val) as unknown;
        } catch {
          return [];
        }
      }
      return val ?? [];
    }, z.array(availableCommandSchema))
    .default([]),
  plan: z
    .preprocess(
      (val) => {
        if (typeof val === 'string') {
          try {
            return JSON.parse(val) as unknown;
          } catch {
            return [];
          }
        }
        return val ?? [];
      },
      z.array(
        z.object({
          name: z.string(),
          status: z.enum(['pending', 'in_progress', 'completed']),
          isCompleted: z.boolean(),
        }),
      ),
    )
    .default([]),
  sessionConfigOptions: z
    .preprocess((val) => {
      if (typeof val === 'string') {
        try {
          return JSON.parse(val) as unknown;
        } catch {
          return [];
        }
      }
      return val ?? [];
    }, sessionConfigOptionsSchema)
    .default([]),
  sessionMetrics: z
    .preprocess((val) => {
      if (typeof val === 'string') {
        try {
          return JSON.parse(val) as unknown;
        } catch {
          return {};
        }
      }
      return val ?? {};
    }, sessionMetricsSchema)
    .default({}),
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

export const projectListRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  repoRoot: z.string().nullable(),
  subdir: z.string(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  isGitRepo: z.boolean(),
  sessions: z.array(sessionRowSchema),
  lastActiveTime: z.number(),
});

export const mcpToolResultSchema = z
  .object({
    content: z.array(
      z
        .object({
          type: z.string(),
          text: z.string().optional(),
        })
        .loose(),
    ),
    isError: z.boolean().optional(),
  })
  .loose();

export type Project = z.infer<typeof projectSchema>;
export type ProviderName = z.infer<typeof providerSchema>;
export type SessionMode = z.infer<typeof sessionModeSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type AvailableCommand = z.infer<typeof availableCommandSchema>;
export type SessionRow = z.infer<typeof sessionRowSchema>;
export type SessionProviderSelection = z.infer<typeof sessionProviderSelectionSchema>;
export type ProviderCapability = z.infer<typeof providerCapabilitySchema>;
export type ThinkingEffort = z.infer<typeof thinkingEffortSchema>;
export type SessionMetrics = z.infer<typeof sessionMetricsSchema>;
export type SessionWithCapabilities = z.infer<typeof sessionWithCapabilitiesSchema>;
export type SessionStatus = z.infer<typeof sessionStatusSchema>;
export type ApprovalMode = z.infer<typeof approvalModeSchema>;
export type ProviderStatus = z.infer<typeof providerStatusSchema>;
export type ACPConfigOption = z.infer<typeof acpConfigOptionSchema>;
export type SessionConfigOptions = z.infer<typeof sessionConfigOptionsSchema>;
export type ProviderDiscovery = z.infer<typeof providerDiscoverySchema>;
export type AuthMethod = z.infer<typeof authMethodSchema>;
export type ProjectListRow = z.infer<typeof projectListRowSchema>;
export type McpToolResult = z.infer<typeof mcpToolResultSchema>;
