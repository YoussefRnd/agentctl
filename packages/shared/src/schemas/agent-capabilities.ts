import { z } from 'zod';
export const agentConfigOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  category: z.string().optional(),
  type: z.enum(['select', 'boolean']).default('select'),
  currentValue: z.union([z.string(), z.boolean()]),
  options: z
    .array(
      z.object({
        value: z.string(),
        name: z.string(),
        contextWindow: z.number().int().positive().optional(),
        description: z.string().optional(),
      }),
    )
    .optional(),
});

export type AgentConfigOption = z.infer<typeof agentConfigOptionSchema>;

export const agentFeaturesSchema = z.object({
  sessions: z.object({
    resume: z.boolean(),
    fork: z.boolean(),
    delete: z.boolean(),
    list: z.boolean(),
  }),
  prompts: z.object({
    image: z.boolean(),
    audio: z.boolean(),
    embeddedContext: z.boolean(),
  }),
  configuration: z.object({
    model: z.boolean(),
    options: z.boolean(),
  }),
  authentication: z.object({ logout: z.boolean() }),
});

export type AgentFeatures = z.infer<typeof agentFeaturesSchema>;

export const EMPTY_AGENT_FEATURES: AgentFeatures = {
  sessions: { resume: false, fork: false, delete: false, list: false },
  prompts: { image: false, audio: false, embeddedContext: false },
  configuration: { model: false, options: false },
  authentication: { logout: false },
};

/** Resolves the canonical feature snapshot while accepting legacy provider fields. */
export function resolveAgentFeatures(source?: {
  features?: AgentFeatures;
  agent?: { features?: AgentFeatures };
  supportsDynamicModel?: boolean;
  supportsDynamicConfig?: boolean;
  supportsLogout?: boolean;
}): AgentFeatures {
  const advertised = source?.features ?? source?.agent?.features;
  return {
    sessions: { ...EMPTY_AGENT_FEATURES.sessions, ...advertised?.sessions },
    prompts: { ...EMPTY_AGENT_FEATURES.prompts, ...advertised?.prompts },
    configuration: {
      model: advertised?.configuration.model ?? source?.supportsDynamicModel ?? false,
      options: advertised?.configuration.options ?? source?.supportsDynamicConfig ?? false,
    },
    authentication: {
      logout: advertised?.authentication.logout ?? source?.supportsLogout ?? false,
    },
  };
}

export const capabilitySnapshotSchema = z.object({
  features: agentFeaturesSchema,
  source: z.enum(['registry', 'probe', 'handshake']),
  providerVersion: z.string().optional(),
  protocolVersion: z.string().optional(),
  verifiedAt: z.coerce.date(),
  commandHash: z.string().optional(),
});

export type CapabilitySnapshot = z.infer<typeof capabilitySnapshotSchema>;

export function createCapabilitySnapshot(
  features: AgentFeatures,
  source: 'registry' | 'probe' | 'handshake',
  options?: {
    providerVersion?: string;
    protocolVersion?: string;
    verifiedAt?: Date;
    commandHash?: string;
  },
): CapabilitySnapshot {
  return {
    features,
    source,
    providerVersion: options?.providerVersion,
    protocolVersion: options?.protocolVersion,
    verifiedAt: options?.verifiedAt ?? new Date(),
    commandHash: options?.commandHash,
  };
}
