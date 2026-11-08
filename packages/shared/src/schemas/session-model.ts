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

export const reportedCostSchema = z.object({
  amount: z.number().finite().nonnegative(),
  currency: z.string().trim().min(1).max(32),
});
export type ReportedCost = z.infer<typeof reportedCostSchema>;

/** Preserve unknown amounts/currencies; never invent USD or turn missing values into zero. */
export function normalizeReportedCost(value: unknown): ReportedCost | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const amount =
    typeof raw.amount === 'string' && raw.amount.trim() !== '' ? Number(raw.amount) : raw.amount;
  const result = reportedCostSchema.safeParse({ amount, currency: raw.currency });
  return result.success ? result.data : undefined;
}

export const sessionMetricsSchema = z.object({
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  totalTokens: z.number().optional(),
  contextLimit: z.number().optional(),
  reportedCost: z
    .preprocess((value) => normalizeReportedCost(value) ?? null, reportedCostSchema.nullable())
    .optional(),
  lastTurn: z
    .object({
      inputTokens: z.number().nonnegative().optional(),
      outputTokens: z.number().nonnegative().optional(),
      totalTokens: z.number().nonnegative().optional(),
      cachedReadTokens: z.number().nonnegative().optional(),
      cachedWriteTokens: z.number().nonnegative().optional(),
      thoughtTokens: z.number().nonnegative().optional(),
      cost: z.preprocess(normalizeReportedCost, reportedCostSchema.optional()),
    })
    .optional(),
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

function decodeSessionField<T extends z.ZodType>(
  schema: T,
  fallback: Exclude<z.output<T>, undefined>,
) {
  return z
    .preprocess((value) => {
      if (typeof value !== 'string') return value ?? fallback;
      try {
        return JSON.parse(value) as unknown;
      } catch {
        return fallback;
      }
    }, schema)
    .default(fallback);
}

export const sessionRowSchema = sessionSchema.extend({
  id: z.uuid(),
  worktreePath: z.string().min(1),
  agentSessionId: z.string().nullable(),
  discardBackup: z.string().nullable().optional(),
  status: sessionStatusSchema,
  mode: sessionModeSchema.default('local'),
  totalTokens: z.number(),
  contextUsedTokens: z.number().finite().nonnegative().nullable().optional(),
  contextLimit: z.number(),
  estimatedCost: z.number(),
  lastHeartbeat: z.coerce.date().nullable(),
  closedAt: z.coerce.date().nullable(),
  lastActivityAt: z.coerce.date(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  hasUserActivity: z.boolean().optional(),
  pinnedAt: z.coerce.date().nullable().optional(),
  settledAt: z.coerce.date().nullable().optional(),
  lastReadEventId: z.number().int().nonnegative().optional(),
  latestActivityEventId: z.number().int().nonnegative().optional(),
  sidebarActivity: z
    .enum(['working', 'approval', 'input', 'failed', 'completed', 'stopped', 'idle'])
    .optional(),
  selectedProvider: providerSchema,
  selectedModel: z.string().min(1),
  selectedThinkingEffort: thinkingEffortSchema,
  approvalMode: approvalModeSchema,
  agentPersona: z.string().nullable().default(null),
  availableAgentPersonas: decodeSessionField(z.array(z.string()), []),
  project: projectSchema.optional(),
  availableCommands: decodeSessionField(z.array(availableCommandSchema), []),
  planArtifacts: decodeSessionField(z.array(planArtifactSchema), []),
  plan: decodeSessionField(z.array(planItemSchema), []),
  sessionConfigOptions: decodeSessionField(sessionConfigOptionsSchema, []),
  sessionMetrics: decodeSessionField(sessionMetricsSchema, {}),
});

export const sessionWithCapabilitiesSchema = z.object({
  session: sessionRowSchema,
  capabilities: z.array(providerCapabilitySchema),
});

export type Session = z.infer<typeof sessionSchema>;
export type AvailableCommand = z.infer<typeof availableCommandSchema>;
export type SessionRow = z.infer<typeof sessionRowSchema>;
export type SessionProviderSelection = z.infer<typeof sessionProviderSelectionSchema>;
export type SessionMetrics = z.infer<typeof sessionMetricsSchema>;
export type SessionWithCapabilities = z.infer<typeof sessionWithCapabilitiesSchema>;
export type SessionStatus = z.infer<typeof sessionStatusSchema>;
export type SessionConfigOptions = z.infer<typeof sessionConfigOptionsSchema>;
