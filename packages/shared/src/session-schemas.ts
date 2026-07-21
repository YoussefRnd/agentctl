import { z } from 'zod';

export const providerSchema = z.string().min(1);

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

import {
  registryAgentSchema,
  acpConfigOptionSchema,
  authMethodSchema,
} from './registry-schemas.js';

export const installStateSchema = z.enum(['not_installed', 'installed_local', 'system_available']);
export const authStateSchema = z.enum(['unknown', 'authenticated', 'needs_auth', 'error']);

export const providerDiscoverySchema = z.object({
  // Legacy fields (retained to keep the monolith compiling)
  id: z.string(),
  label: z.string(),
  configOptions: z.array(acpConfigOptionSchema).optional(),
  authMethods: z.array(authMethodSchema).optional().default([]),
  version: z.string().optional(),
  description: z.string().optional(),
  icon: z.string().optional(),
  supportsDynamicModel: z.boolean().optional().default(false),
  supportsDynamicConfig: z.boolean().optional().default(false),
  supportsLogout: z.boolean().optional().default(false),
  nativelyLoadsSkills: z.boolean().optional().default(false),

  // New fields
  installState: installStateSchema.optional(),
  authState: authStateSchema.optional(),
  status: providerStatusSchema.optional(),
  enabled: z.boolean().default(true),
  hidden: z.boolean().optional(),
  agent: registryAgentSchema.optional(),

  // Shared fields
  command: z.string(),
  launchArgs: z.array(z.string()).default([]),
  launchEnv: z.record(z.string(), z.string()).default({}),
  customEnv: z.record(z.string(), z.string()).default({}),
  customEnvConfigured: z.record(z.string(), z.boolean()).optional().default({}),
});

export function getProviderEnvKeys(provider: {
  id: string;
  authMethods?: { type?: string; vars?: { name: string }[] }[] | null;
}): string[] {
  return (
    provider.authMethods
      ?.filter((m) => m.type === 'env_var')
      .flatMap((m) => m.vars?.map((v) => v.name) ?? []) ?? []
  );
}

export const availableCommandSchema = z.object({
  name: z.string(),
  description: z.string(),
  input: z
    .object({
      hint: z.string(),
    })
    .optional(),
  category: z.string().optional(),
});

export const elicitationFormFieldSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: z.enum(['string', 'number', 'boolean', 'select']).default('string'),
  default: z.string().optional(),
  required: z.boolean().optional().default(false),
  options: z
    .array(
      z.object({
        label: z.string(),
        value: z.string(),
      }),
    )
    .optional(),
});

export const formElicitationSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  fields: z.array(elicitationFormFieldSchema),
});

export const urlElicitationSchema = z.object({
  url: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
});

export const elicitationRequestSchema = z.object({
  id: z.string(),
  mode: z.enum(['form', 'url']),
  form: formElicitationSchema.optional(),
  url: urlElicitationSchema.optional(),
});

export const elicitationResponseSchema = z.object({
  action: z.enum(['submit', 'cancel']),
  values: z.record(z.string(), z.unknown()).optional(),
});

export const elicitationItemSchema = z.object({
  id: z.string(),
  request: elicitationRequestSchema,
  status: z.enum(['pending', 'completed', 'cancelled']),
  createdAt: z.string(),
  response: elicitationResponseSchema.optional(),
});

export const permissionOptionKindSchema = z.enum([
  'allow_once',
  'allow_always',
  'reject_once',
  'reject_always',
]);

export const permissionOptionSchema = z.object({
  option_id: z.string(),
  kind: permissionOptionKindSchema,
  name: z.string(),
  description: z.string().optional(),
});

export const permissionOptionChoiceSchema = z.object({
  allow: permissionOptionSchema,
  deny: permissionOptionSchema,
  sub_patterns: z.array(z.string()).default([]),
});

export const permissionPatternSchema = z.object({
  pattern: z.string(),
  display_name: z.string(),
});

export const permissionOptionsSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('flat'),
    options: z.array(permissionOptionSchema),
  }),
  z.object({
    type: z.literal('dropdown'),
    choices: z.array(permissionOptionChoiceSchema),
  }),
  z.object({
    type: z.literal('dropdown_with_patterns'),
    choices: z.array(permissionOptionChoiceSchema),
    patterns: z.array(permissionPatternSchema),
    tool_name: z.string(),
  }),
]);

export const selectedPermissionParamsSchema = z.object({
  patterns: z.array(z.string()).optional(),
});

export const selectedPermissionOutcomeSchema = z.object({
  option_id: z.string(),
  option_kind: permissionOptionKindSchema,
  params: selectedPermissionParamsSchema.optional(),
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

export type ElicitationFormField = z.infer<typeof elicitationFormFieldSchema>;
export type FormElicitation = z.infer<typeof formElicitationSchema>;
export type UrlElicitation = z.infer<typeof urlElicitationSchema>;
export type ElicitationRequest = z.infer<typeof elicitationRequestSchema>;
export type ElicitationResponse = z.infer<typeof elicitationResponseSchema>;
export type ElicitationItem = z.infer<typeof elicitationItemSchema>;

export type PermissionOptionKind = z.infer<typeof permissionOptionKindSchema>;
export type PermissionOption = z.infer<typeof permissionOptionSchema>;
export type PermissionOptionChoice = z.infer<typeof permissionOptionChoiceSchema>;
export type PermissionPattern = z.infer<typeof permissionPatternSchema>;
export type PermissionOptions = z.infer<typeof permissionOptionsSchema>;
export type SelectedPermissionParams = z.infer<typeof selectedPermissionParamsSchema>;
export type SelectedPermissionOutcome = z.infer<typeof selectedPermissionOutcomeSchema>;
