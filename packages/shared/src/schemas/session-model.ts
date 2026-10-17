import { z } from 'zod';
import { planArtifactSchema, planItemSchema } from './plan.js';
import { agentConfigOptionSchema } from './agent-capabilities.js';
import { providerCapabilitySchema } from './providers.js';
import { projectSchema } from './projects.js';
import {
  providerSchema,
  sessionModeSchema,
  approvalModeSchema,
  thinkingEffortSchema,
} from './session-options.js';
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

export const sessionStatusSchema = z.enum([
  'running',
  'needs_attention',
  'idle',
  'error',
  'merged',
  'discarded',
  'archived',
]);

export const sessionRowSchema = sessionSchema.extend({
  id: z.uuid(),
  worktreePath: z.string().min(1),
  agentSessionId: z.string().nullable(),
  discardBackup: z.string().nullable().optional(),
  status: sessionStatusSchema,
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

export type Session = z.infer<typeof sessionSchema>;
export type AvailableCommand = z.infer<typeof availableCommandSchema>;
export type SessionRow = z.infer<typeof sessionRowSchema>;
export type HandoffSession = z.infer<typeof handoffSessionSchema>;
export type HandoffSessionResponse = z.infer<typeof handoffSessionResponseSchema>;
export type SessionProviderSelection = z.infer<typeof sessionProviderSelectionSchema>;
export type SessionMetrics = z.infer<typeof sessionMetricsSchema>;
export type SessionWithCapabilities = z.infer<typeof sessionWithCapabilitiesSchema>;
export type SessionStatus = z.infer<typeof sessionStatusSchema>;
export type SessionConfigOptions = z.infer<typeof sessionConfigOptionsSchema>;
