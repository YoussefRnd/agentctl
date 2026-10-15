import { customModelsSchema } from '../custom-models.js';
import { planArtifactSchema, planItemSchema } from './plan.js';
import { z } from 'zod';
import {
  registryAgentSchema,
  agentConfigOptionSchema,
  agentFeaturesSchema,
  authMethodSchema,
  capabilitySnapshotSchema,
} from './registry.js';

export const providerSchema = z.string().min(1);

export const sessionModeSchema = z.enum(['worktree', 'local']);

export const approvalModeSchema = z.enum(['review', 'auto_approve', 'yolo']);

/** Null means no provider reasoning override; non-null IDs are provider-defined. */
export const thinkingEffortSchema = z.string().min(1).nullable();

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
  selectedModel: z.string().min(1).optional(),
  selectedThinkingEffort: thinkingEffortSchema.optional(),
  approvalMode: approvalModeSchema.optional(),
  agentPersona: z.string().min(1).optional(),
});

export const handoffSessionSchema = z.object({
  targetProvider: providerSchema,
  targetModel: z.string().optional(),
  nextSessionFocus: z.string().optional(),
});

export const handoffSessionResponseSchema = z.object({
  sessionId: z.string(),
  handoffFilePath: z.string(),
  initialPrompt: z.string(),
  handoffSource: z.enum(['skill', 'generated']),
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
  customModels: customModelsSchema.optional(),
  defaultModel: z.string().optional(),
  defaultThinkingEffort: z.string().optional(),
  id: z.string(),
  label: z.string(),
  status: providerStatusSchema,
  command: z.string(),
  configOptions: z.array(agentConfigOptionSchema).optional(),
  version: z.string().optional(),
  description: z.string().optional(),
  icon: z.string().optional(),
  supportsDynamicModel: z.boolean().optional(),
  supportsDynamicConfig: z.boolean().optional(),
  modes: z.array(z.string()).optional().default([]),
  features: agentFeaturesSchema.optional(),
  snapshot: capabilitySnapshotSchema.optional(),
});

export const installStateSchema = z.enum([
  'not_installed',
  'installing',
  'installed_local',
  'system_available',
  'failed',
]);
export type InstallState = z.infer<typeof installStateSchema>;
export const installStageSchema = z.enum([
  'preparing',
  'downloading',
  'verifying',
  'extracting',
  'activating',
  'connecting',
]);
export type InstallStage = z.infer<typeof installStageSchema>;
export const installSourceSchema = z.enum(['managed', 'system', 'npx', 'uvx']);
export type InstallSource = z.infer<typeof installSourceSchema>;
export const connectionStateSchema = z.enum(['unknown', 'checking', 'ready', 'error']);
export type ConnectionState = z.infer<typeof connectionStateSchema>;

export const authErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
});
export type AuthError = z.infer<typeof authErrorSchema>;

export const canonicalAuthStateSchema = z.enum([
  'unknown',
  'not_required',
  'required',
  'authenticating',
  'verifying',
  'authenticated',
  'error',
]);

export const authStateSchema = z.preprocess((val: unknown) => {
  if (val === 'needs_auth') return 'required';
  return val;
}, canonicalAuthStateSchema);

export type AuthState = z.infer<typeof canonicalAuthStateSchema>;

export const providerDiscoverySchema = z.object({
  customModels: customModelsSchema.optional(),
  authInteraction: z.object({ id: z.string(), url: z.url(), message: z.string() }).optional(),
  registryAgentId: z.string().optional(),
  isProfile: z.boolean().optional(),
  protocol: z.enum(['auto', 'v1', 'v2']).optional(),
  defaultModel: z.string().optional(),
  defaultThinkingEffort: z.string().optional(),
  // Legacy fields (retained to keep the monolith compiling)
  id: z.string(),
  label: z.string(),
  configOptions: z.array(agentConfigOptionSchema).optional(),
  authMethods: z.array(authMethodSchema).optional().default([]),
  version: z.string().optional(),
  description: z.string().optional(),
  icon: z.string().optional(),
  supportsDynamicModel: z.boolean().optional().default(false),
  supportsDynamicConfig: z.boolean().optional().default(false),
  supportsLogout: z.boolean().optional().default(false),
  features: agentFeaturesSchema.optional(),
  snapshot: capabilitySnapshotSchema.optional(),
  nativelyLoadsSkills: z.boolean().optional().default(false),
  modes: z.array(z.string()).optional(),

  // New fields
  installState: installStateSchema.optional(),
  installError: z.string().nullable().optional(),
  installStage: installStageSchema.nullable().optional(),
  installProgress: z
    .object({
      downloadedBytes: z.number().nonnegative(),
      totalBytes: z.number().positive().nullable(),
    })
    .nullable()
    .optional(),
  installSource: installSourceSchema.nullable().optional(),
  installedVersion: z.string().nullable().optional(),
  availableVersion: z.string().optional(),
  updateAvailable: z.boolean().optional().default(false),
  connectionState: connectionStateSchema.optional().default('unknown'),
  authState: authStateSchema.optional().default('unknown'),
  authError: authErrorSchema.nullable().optional(),
  lastVerifiedAt: z.coerce.date().nullable().optional(),
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
  customEnv?: Record<string, string>;
  customEnvConfigured?: Record<string, boolean>;
}): string[] {
  const fromMethods =
    provider.authMethods
      ?.filter((m) => m.type === 'env_var')
      .flatMap((m) => m.vars?.map((v) => v.name) ?? []) ?? [];
  const fromConfig = Object.keys(provider.customEnvConfigured ?? {});
  const fromEnv = Object.keys(provider.customEnv ?? {});
  return [...new Set([...fromMethods, ...fromConfig, ...fromEnv])];
}

export function isProviderEnvKeyOptional(
  provider: {
    authMethods?: { type?: string; vars?: { name: string; optional?: boolean }[] }[] | null;
  },
  key: string,
): boolean {
  return (
    provider.authMethods
      ?.filter((method) => method.type === 'env_var')
      .flatMap((method) => method.vars ?? [])
      .some((variable) => variable.name === key && variable.optional === true) ?? false
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
  description: z.string().optional(),
  type: z
    .enum(['string', 'number', 'integer', 'boolean', 'select', 'multi_select'])
    .default('string'),
  default: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]).optional(),
  required: z.boolean().optional().default(false),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  minLength: z.number().int().nonnegative().optional(),
  maxLength: z.number().int().nonnegative().optional(),
  pattern: z.string().optional(),
  format: z.enum(['email', 'uri', 'date', 'date-time']).optional(),
  minItems: z.number().int().nonnegative().optional(),
  maxItems: z.number().int().nonnegative().optional(),
  options: z
    .array(
      z.object({
        label: z.string(),
        value: z.string(),
        description: z.string().optional(),
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
  subagentId: z.string().optional(),
  id: z.string(),
  mode: z.enum(['form', 'url']),
  message: z.string(),
  sessionId: z.string().optional(),
  requestId: z.union([z.string(), z.number()]).optional(),
  toolCallId: z.string().optional(),
  form: formElicitationSchema.optional(),
  url: urlElicitationSchema.optional(),
});

export const elicitationResponseSchema = z.object({
  action: z.enum(['submit', 'decline', 'cancel']),
  values: z.record(z.string(), z.unknown()).optional(),
});

export const elicitationItemSchema = z.object({
  id: z.string(),
  request: elicitationRequestSchema,
  status: z.enum(['pending', 'completed', 'declined', 'cancelled']),
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

export const sessionConfigOptionsSchema = z.array(agentConfigOptionSchema);

export const sessionMetricsSchema = z.object({
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  totalTokens: z.number().optional(),
  contextLimit: z.number().optional(),
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
  discardBackup: z.string().nullable().optional(),
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
  lastActivityAt: z.coerce.date(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  hasUserActivity: z.boolean().optional(),
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
  planArtifacts: z
    .preprocess((value) => {
      if (typeof value === 'string') {
        try {
          return JSON.parse(value);
        } catch {
          return [];
        }
      }
      return value ?? [];
    }, z.array(planArtifactSchema))
    .default([]),
  plan: z
    .preprocess((val) => {
      if (typeof val === 'string') {
        try {
          return JSON.parse(val) as unknown;
        } catch {
          return [];
        }
      }
      return val ?? [];
    }, z.array(planItemSchema))
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
export type HandoffSession = z.infer<typeof handoffSessionSchema>;
export type HandoffSessionResponse = z.infer<typeof handoffSessionResponseSchema>;
export type SessionProviderSelection = z.infer<typeof sessionProviderSelectionSchema>;
export type ProviderCapability = z.infer<typeof providerCapabilitySchema>;
export type ThinkingEffort = z.infer<typeof thinkingEffortSchema>;
export type SessionMetrics = z.infer<typeof sessionMetricsSchema>;
export type SessionWithCapabilities = z.infer<typeof sessionWithCapabilitiesSchema>;
export type SessionStatus = z.infer<typeof sessionStatusSchema>;
export type ApprovalMode = z.infer<typeof approvalModeSchema>;
export type ProviderStatus = z.infer<typeof providerStatusSchema>;
export type SessionConfigOptions = z.infer<typeof sessionConfigOptionsSchema>;
export type ProviderDiscovery = z.infer<typeof providerDiscoverySchema>;
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
