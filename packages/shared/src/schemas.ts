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
  launchArgs: z.array(z.string()).optional().default([]),
  launchEnv: z.record(z.string(), z.string()).optional().default({}),
  configOptions: z.array(acpConfigOptionSchema).optional(),
  version: z.string().optional(),
  description: z.string().optional(),
  icon: z.url().optional(),
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
 * ACP Event Data Schemas
 */
export const acpEventTextDataSchema = z.object({
  content: z.string(),
});

export const acpEventToolCallDataSchema = z.object({
  name: z.string(),
  arguments: z.record(z.string(), z.any()).optional(),
  toolCallId: z.string().optional(),
}).loose();

export const acpEventApprovalRequestDataSchema = z.object({
  message: z.string().optional(),
  toolCallId: z.string().optional(),
  request: z.any().optional(),
});

/**
 * ACP Event Schema
 * Note: 'compact' is a special event type used by agentctl to capture 
 * the native agent summarization output during handoffs between sessions.
 */
export const acpEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text'),
    data: acpEventTextDataSchema,
    createdAt: z.coerce.date(),
  }),
  z.object({
    type: z.literal('tool_call'),
    data: acpEventToolCallDataSchema,
    createdAt: z.coerce.date(),
  }),
  z.object({
    type: z.literal('approval_request'),
    data: acpEventApprovalRequestDataSchema,
    createdAt: z.coerce.date(),
  }),
  z.object({
    type: z.literal('diff'),
    data: z.record(z.string(), z.any()),
    createdAt: z.coerce.date(),
  }),
  z.object({
    type: z.literal('status'),
    data: z.record(z.string(), z.any()),
    createdAt: z.coerce.date(),
  }),
  z.object({
    type: z.literal('compact'),
    data: z.record(z.string(), z.any()),
    createdAt: z.coerce.date(),
  }),
]);

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
export type ACPEventTextData = z.infer<typeof acpEventTextDataSchema>;
export type ACPEventToolCallData = z.infer<typeof acpEventToolCallDataSchema>;
export type ACPEventApprovalRequestData = z.infer<typeof acpEventApprovalRequestDataSchema>;
export type DriverStatus = z.infer<typeof driverStatusSchema>;
export type ACPConfigOption = z.infer<typeof acpConfigOptionSchema>;
export type DriverDiscovery = z.infer<typeof driverDiscoverySchema>;

export type ACPEventRow = ACPEvent & {
  id: number;
  sessionId: string;
};

// ACP Registry types
export const registryDistributionNpxSchema = z.object({
  package: z.string().min(1),
  args: z.array(z.string()).optional().default([]),
  env: z.record(z.string(), z.string()).optional().default({}),
});

export const registryDistributionBinaryTargetSchema = z.object({
  archive: z.url(),
  cmd: z.string().min(1),
  args: z.array(z.string()).optional().default([]),
  env: z.record(z.string(), z.string()).optional().default({}),
});

export const registryDistributionUvxSchema = z.object({
  package: z.string().min(1),
  args: z.array(z.string()).optional().default([]),
  env: z.record(z.string(), z.string()).optional().default({}),
});

export const registryDistributionSchema = z.object({
  npx: registryDistributionNpxSchema.optional(),
  binary: z.record(z.string(), registryDistributionBinaryTargetSchema).optional(),
  uvx: registryDistributionUvxSchema.optional(),
});

export const registryAgentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().optional().default(''),
  repository: z.url().optional(),
  website: z.url().optional(),
  authors: z.array(z.string()).optional().default([]),
  license: z.string().optional(),
  distribution: registryDistributionSchema,
  icon: z.url().optional(),
});

export const registrySchema = z.object({
  version: z.string().min(1),
  agents: z.array(registryAgentSchema),
  extensions: z.array(z.unknown()).default([]),
});

export type RegistryDistributionNpx = z.infer<typeof registryDistributionNpxSchema>;
export type RegistryDistributionBinaryTarget = z.infer<typeof registryDistributionBinaryTargetSchema>;
export type RegistryDistributionUvx = z.infer<typeof registryDistributionUvxSchema>;
export type RegistryDistribution = z.infer<typeof registryDistributionSchema>;
export type RegistryAgent = z.infer<typeof registryAgentSchema>;
export type Registry = z.infer<typeof registrySchema>;
