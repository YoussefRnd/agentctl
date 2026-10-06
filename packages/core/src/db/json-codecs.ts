import { z, type ZodType } from 'zod';
import {
  agentFeaturesSchema,
  authErrorSchema,
  EMPTY_AGENT_FEATURES,
  authMethodSchema,
  capabilitySnapshotSchema,
  registryDistributionSchema,
  sessionMetricsSchema,
  sessionEventMetadataSchema,
  sessionEventTextDataSchema,
  sessionEventToolCallDataSchema,
  sessionEventApprovalRequestDataSchema,
  sessionEventPlanDataSchema,
  sessionEventModeDataSchema,
  sessionEventTerminalCreatedDataSchema,
  sessionEventTerminalOutputDataSchema,
  sessionEventTerminalExitDataSchema,
  sessionEventDiffDataSchema,
  sessionEventStatusDataSchema,
  sessionEventCompactDataSchema,
  sessionEventSubagentUpdateDataSchema,
  type AgentConfigOption,
  type AgentFeatures,
  type AuthError,
  type AuthMethod,
  type CapabilitySnapshot,
  type RegistryDistribution,
  type SessionMetrics,
  type SessionEventTextData,
  type SessionEventToolCallData,
  type SessionEventApprovalRequestData,
  type SessionEventPlanData,
  type SessionEventModeData,
  type SessionEventMetadata,
  type SessionEventType,
  type SessionEventPayload,
} from '@agentctl/shared';

export function decodeJson<T>(
  value: string | null | undefined,
  schema: ZodType<T>,
  fallback: T,
): T {
  if (!value) return fallback;
  try {
    const result = schema.safeParse(JSON.parse(value) as unknown);
    return result.success ? result.data : fallback;
  } catch {
    return fallback;
  }
}

function parseSessionEventData<T extends SessionEventType>(
  type: T,
  value: unknown,
): SessionEventPayload<T>;
function parseSessionEventData(type: string, value: unknown): unknown;
function parseSessionEventData(type: string, value: unknown): unknown {
  const parsed = parseJsonValue(value);
  switch (type) {
    case 'text':
      return sessionEventCodecs.text(parsed);
    case 'tool_call':
      return sessionEventCodecs.toolCall(parsed);
    case 'approval_request':
      return sessionEventCodecs.approvalRequest(parsed);
    case 'plan_update':
      return sessionEventCodecs.planUpdate(parsed);
    case 'mode_update':
      return sessionEventCodecs.modeUpdate(parsed);
    case 'terminal_created':
      return parseOrFallback(sessionEventTerminalCreatedDataSchema, parsed, {
        terminalId: '',
        command: '',
      });
    case 'terminal_output':
      return parseOrFallback(sessionEventTerminalOutputDataSchema, parsed, {
        terminalId: '',
        data: '',
      });
    case 'terminal_exit':
      return parseOrFallback(sessionEventTerminalExitDataSchema, parsed, {
        terminalId: '',
        code: null,
      });
    case 'diff':
      return parseOrFallback(sessionEventDiffDataSchema, parsed, {});
    case 'status':
      return parseOrFallback(sessionEventStatusDataSchema, parsed, {});
    case 'compact':
      return parseOrFallback(sessionEventCompactDataSchema, parsed, {});
    case 'subagent_update':
      return parseOrFallback(sessionEventSubagentUpdateDataSchema, parsed, {
        subagentId: '',
        name: '',
        scope: '',
        status: 'failed' as const,
      });
    default:
      return parsed;
  }
}

const stringArraySchema = z.array(z.string());
const stringRecordSchema = z.record(z.string(), z.string());
const unknownRecordSchema = z.record(z.string(), z.unknown());
const agentSessionMapSchema = z.record(z.string(), z.string());
const toolPermissionRecordSchema = z.record(
  z.string(),
  z.enum(['always_prompt', 'auto_approve', 'deny']),
);
const persistedAgentConfigOptionSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    category: z.string().optional(),
    type: z.string().optional(),
    currentValue: z.union([z.string(), z.boolean()]).optional(),
    options: z
      .array(
        z.object({
          value: z.string(),
          name: z.string().optional(),
          description: z.string().optional(),
          contextWindow: z.number().int().positive().optional(),
        }),
      )
      .optional(),
  })
  .transform((option): AgentConfigOption => ({
    id: option.id,
    name: option.name,
    description: option.description,
    category: option.category,
    type: option.type === 'boolean' ? 'boolean' : 'select',
    currentValue: option.currentValue ?? option.options?.[0]?.value ?? false,
    options: option.options?.map((entry) => ({
      value: entry.value,
      name: entry.name ?? entry.value,
      description: entry.description,
      contextWindow: entry.contextWindow,
    })),
  }));

export const jsonCodecs = {
  stringArray(value: string | null | undefined): string[] {
    return decodeJson(value, stringArraySchema, []);
  },
  stringRecord(value: string | null | undefined): Record<string, string> {
    return decodeJson(value, stringRecordSchema, {});
  },
  unknownRecord(value: string | null | undefined): Record<string, unknown> {
    return decodeJson(value, unknownRecordSchema, {});
  },
  agentSessionMap(value: string | null | undefined): Record<string, string> | null {
    return decodeJson(value, agentSessionMapSchema.nullable(), null);
  },
  toolPermissions(
    value: string | null | undefined,
  ): Record<string, 'always_prompt' | 'auto_approve' | 'deny'> {
    return decodeJson(value, toolPermissionRecordSchema, {});
  },
  agentConfigOptions(value: string | null | undefined): AgentConfigOption[] {
    return decodeJson(value, z.array(persistedAgentConfigOptionSchema), []);
  },
  agentConfigOptionsOrNull(value: string | null | undefined): AgentConfigOption[] | null {
    return decodeJson(value, z.array(persistedAgentConfigOptionSchema).nullable(), null);
  },
  agentFeatures(value: string | null | undefined): AgentFeatures {
    return decodeJson(value, agentFeaturesSchema, EMPTY_AGENT_FEATURES);
  },
  capabilitySnapshot(value: string | null | undefined): CapabilitySnapshot | undefined {
    if (!value) return undefined;
    try {
      const result = capabilitySnapshotSchema.safeParse(JSON.parse(value) as unknown);
      return result.success ? result.data : undefined;
    } catch {
      return undefined;
    }
  },
  authMethods(value: string | null | undefined): AuthMethod[] {
    return decodeJson(value, z.array(authMethodSchema), []);
  },
  authError(value: string | null | undefined): AuthError | null {
    return decodeJson(value, authErrorSchema.nullable(), null);
  },
  registryDistribution(value: string | null | undefined): RegistryDistribution {
    return decodeJson(value, registryDistributionSchema, {});
  },
  sessionMetrics(value: string | null | undefined): SessionMetrics {
    return decodeJson(value, sessionMetricsSchema, {});
  },
  sessionEventData(type: string, value: unknown): unknown {
    return sessionEventCodecs.parseData(type, value);
  },
  sessionEventMetadata(value: unknown): Record<string, unknown> {
    return sessionEventCodecs.parseMetadata(value);
  },
};

export const sessionEventCodecs = {
  text(value: unknown): SessionEventTextData {
    if (typeof value === 'string') {
      return decodeJson(value, sessionEventTextDataSchema, { content: '' });
    }
    const res = sessionEventTextDataSchema.safeParse(value);
    return res.success ? res.data : { content: '' };
  },
  toolCall(value: unknown): SessionEventToolCallData {
    if (typeof value === 'string') {
      return decodeJson(value, sessionEventToolCallDataSchema, { name: '' });
    }
    const res = sessionEventToolCallDataSchema.safeParse(value);
    return res.success ? res.data : { name: '' };
  },
  approvalRequest(value: unknown): SessionEventApprovalRequestData {
    if (typeof value === 'string') {
      return decodeJson(value, sessionEventApprovalRequestDataSchema, {});
    }
    const res = sessionEventApprovalRequestDataSchema.safeParse(value);
    return res.success ? res.data : {};
  },
  planUpdate(value: unknown): SessionEventPlanData {
    if (typeof value === 'string') {
      return decodeJson(value, sessionEventPlanDataSchema, { plan: [] });
    }
    const res = sessionEventPlanDataSchema.safeParse(value);
    return res.success ? res.data : { plan: [] };
  },
  modeUpdate(value: unknown): SessionEventModeData {
    if (typeof value === 'string') {
      return decodeJson(value, sessionEventModeDataSchema, { mode: '' });
    }
    const res = sessionEventModeDataSchema.safeParse(value);
    return res.success ? res.data : { mode: '' };
  },
  metadata(value: unknown): SessionEventMetadata {
    if (typeof value === 'string') {
      return decodeJson(value, sessionEventMetadataSchema, {});
    }
    const res = sessionEventMetadataSchema.safeParse(value);
    return res.success ? res.data : {};
  },
  parseData: parseSessionEventData,
  validateData<T extends SessionEventType>(type: T, value: SessionEventPayload<T>): unknown {
    const schema = eventDataSchemas[type];
    return schema.parse(parseJsonValue(value));
  },
  validateMetadata(value: SessionEventMetadata | null | undefined): SessionEventMetadata | null {
    return value == null ? null : sessionEventMetadataSchema.parse(value);
  },
  parseMetadata(value: unknown): SessionEventMetadata {
    return sessionEventCodecs.metadata(value);
  },
};

function parseJsonValue(value: unknown): unknown {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

function parseOrFallback<T>(schema: ZodType<T>, value: unknown, fallback: T): T {
  const result = schema.safeParse(value);
  return result.success ? result.data : fallback;
}

const eventDataSchemas: Record<SessionEventType, ZodType> = {
  text: sessionEventTextDataSchema,
  tool_call: sessionEventToolCallDataSchema,
  approval_request: sessionEventApprovalRequestDataSchema,
  plan_update: sessionEventPlanDataSchema,
  mode_update: sessionEventModeDataSchema,
  terminal_created: sessionEventTerminalCreatedDataSchema,
  terminal_output: sessionEventTerminalOutputDataSchema,
  terminal_exit: sessionEventTerminalExitDataSchema,
  diff: sessionEventDiffDataSchema,
  status: sessionEventStatusDataSchema,
  compact: sessionEventCompactDataSchema,
  subagent_update: sessionEventSubagentUpdateDataSchema,
};
