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
  sessionEventPayloadSchemas,
  type AgentConfigOption,
  type AgentFeatures,
  type AuthError,
  type AuthMethod,
  type CapabilitySnapshot,
  type RegistryDistribution,
  type SessionMetrics,
  type SessionEvent,
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

const eventFallbacks = {
  text: { content: '' },
  tool_call: { name: '' },
  approval_request: {},
  plan_update: { plan: [] },
  mode_update: { mode: '' },
  terminal_created: { terminalId: '', command: '' },
  terminal_output: { terminalId: '', data: '' },
  terminal_exit: { terminalId: '', code: null },
  diff: {},
  status: {},
  compact: {},
  subagent_update: { subagentId: '', name: '', scope: '', status: 'failed' },
} satisfies { [Event in SessionEvent as Event['type']]: Event['data'] };

// Older readers for these event kinds also accepted a JSON string inside the stored JSON.
const nestedJsonEventTypes = new Set<SessionEventType>([
  'text',
  'tool_call',
  'approval_request',
  'plan_update',
  'mode_update',
]);

function parseSessionEventData<T extends SessionEventType>(
  type: T,
  value: unknown,
): Extract<SessionEvent, { type: T }>['data'];
function parseSessionEventData(type: string, value: unknown): unknown;
function parseSessionEventData(type: string, value: unknown): unknown {
  const parsed = parseJsonValue(value);
  if (!Object.hasOwn(eventFallbacks, type)) return parsed;
  const kind = type as SessionEventType;
  const schema: ZodType = sessionEventPayloadSchemas[kind];
  const payload =
    typeof parsed === 'string' && nestedJsonEventTypes.has(kind) ? parseJsonValue(parsed) : parsed;
  const result = schema.safeParse(payload);
  return result.success ? result.data : structuredClone(eventFallbacks[kind]);
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
    return decodeJson(value, capabilitySnapshotSchema, undefined);
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
};

export const sessionEventCodecs = {
  parseData: parseSessionEventData,
  validateData<T extends SessionEventType>(type: T, value: SessionEventPayload<T>): unknown {
    const schema: ZodType = sessionEventPayloadSchemas[type];
    return schema.parse(parseJsonValue(value));
  },
  validateMetadata(value: SessionEventMetadata | null | undefined): SessionEventMetadata | null {
    return value == null ? null : sessionEventMetadataSchema.parse(value);
  },
  parseMetadata(value: unknown): SessionEventMetadata {
    const result = sessionEventMetadataSchema.safeParse(parseJsonValue(value));
    return result.success ? result.data : {};
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
