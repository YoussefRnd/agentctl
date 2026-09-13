import { z, type ZodType } from 'zod';
import {
  agentFeaturesSchema,
  EMPTY_AGENT_FEATURES,
  authMethodSchema,
  registryDistributionSchema,
  sessionMetricsSchema,
  type AgentConfigOption,
  type AgentFeatures,
  type AuthMethod,
  type RegistryDistribution,
  type SessionMetrics,
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
  authMethods(value: string | null | undefined): AuthMethod[] {
    return decodeJson(value, z.array(authMethodSchema), []);
  },
  registryDistribution(value: string | null | undefined): RegistryDistribution {
    return decodeJson(value, registryDistributionSchema, {});
  },
  sessionMetrics(value: string | null | undefined): SessionMetrics {
    return decodeJson(value, sessionMetricsSchema, {});
  },
};
