import { z } from 'zod';

export const environmentVariableNameSchema = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Invalid environment variable name');

export const authEnvVarSchema = z.object({
  name: environmentVariableNameSchema,
  label: z.string().optional(),
  secret: z.boolean().default(true),
  optional: z.boolean().default(false),
});

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

export const authMethodTerminalSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.literal('terminal'),
  description: z.string().nullable().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(environmentVariableNameSchema, z.string()).optional(),
  _meta: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const authMethodAgentSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.literal('agent').default('agent'),
  description: z.string().nullable().optional(),
  _meta: z.record(z.string(), z.unknown()).nullable().optional(),
});

/** Legacy registry authentication for agents that still read credentials from env. */
export const authMethodEnvVarSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.literal('env_var'),
  description: z.string().nullable().optional(),
  vars: z.array(authEnvVarSchema).min(1),
  _meta: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const authMethodSchema = z.preprocess(
  (val: unknown) => {
    if (typeof val === 'object' && val !== null) {
      const obj = val as Record<string, unknown>;
      const id = (obj.id ?? obj.methodId) as string | undefined;
      const type =
        obj.type === 'terminal' ? 'terminal' : obj.type === 'env_var' ? 'env_var' : 'agent';
      return { ...obj, id, type };
    }
    return val;
  },
  z.discriminatedUnion('type', [
    authMethodAgentSchema,
    authMethodTerminalSchema,
    authMethodEnvVarSchema,
  ]),
);

export type AuthMethodTerminal = z.infer<typeof authMethodTerminalSchema>;
export type AuthMethodAgent = z.infer<typeof authMethodAgentSchema>;
export type AuthMethodEnvVar = z.infer<typeof authMethodEnvVarSchema>;
export type AuthMethod = z.infer<typeof authMethodSchema>;

export const registryDistributionNpxSchema = z.object({
  package: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(environmentVariableNameSchema, z.string()).optional().default({}),
});

const httpsUrlSchema = z.url().refine((value) => new URL(value).protocol === 'https:', {
  message: 'Provider downloads must use HTTPS',
});

const webUrlSchema = z.url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === 'https:' || protocol === 'http:';
}, 'Provider links must use HTTP or HTTPS');

export const registryDistributionBinaryTargetSchema = z.object({
  archive: httpsUrlSchema,
  cmd: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(environmentVariableNameSchema, z.string()).optional().default({}),
  sha256: z.string().optional(),
});

export const registryDistributionUvxSchema = z.object({
  package: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(environmentVariableNameSchema, z.string()).optional().default({}),
});

export const registryDistributionSchema = z.object({
  npx: registryDistributionNpxSchema.optional(),
  binary: z.record(z.string(), registryDistributionBinaryTargetSchema).optional(),
  uvx: registryDistributionUvxSchema.optional(),
});

export const registryAgentSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/, 'Provider id must be a safe path segment'),
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().optional().default(''),
  repository: webUrlSchema.optional(),
  website: webUrlSchema.optional(),
  authors: z.array(z.string()).optional().default([]),
  license: z.string().optional(),
  distribution: registryDistributionSchema,
  icon: webUrlSchema.optional(),
  configOptions: z.array(agentConfigOptionSchema).optional(),
  authMethods: z.array(authMethodSchema).optional(),
  supportsDynamicModel: z.boolean().optional(),
  supportsDynamicConfig: z.boolean().optional(),
  supportsLogout: z.boolean().optional(),
  features: agentFeaturesSchema.optional(),
});

export const registrySchema = z.object({
  version: z.string().min(1),
  agents: z.array(registryAgentSchema),
  extensions: z.array(z.unknown()).default([]),
});

export type RegistryDistributionNpx = z.infer<typeof registryDistributionNpxSchema>;
export type RegistryDistributionBinaryTarget = z.infer<
  typeof registryDistributionBinaryTargetSchema
>;
export type RegistryDistributionUvx = z.infer<typeof registryDistributionUvxSchema>;
export type RegistryDistribution = z.infer<typeof registryDistributionSchema>;
export type RegistryAgent = z.infer<typeof registryAgentSchema>;
export type Registry = z.infer<typeof registrySchema>;
