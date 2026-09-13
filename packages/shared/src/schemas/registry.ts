import { z } from 'zod';

export const authEnvVarSchema = z.object({
  name: z.string(),
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

/** @deprecated Use agentConfigOptionSchema. */
export const acpConfigOptionSchema = agentConfigOptionSchema;
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

export const authMethodSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['agent', 'env_var']).optional().default('agent'),
  description: z.string().nullable().optional(),
  vars: z.array(authEnvVarSchema).optional(),
});

export const registryDistributionNpxSchema = z.object({
  package: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional().default({}),
});

export const registryDistributionBinaryTargetSchema = z.object({
  archive: z.url(),
  cmd: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional().default({}),
  sha256: z.string().optional(),
});

export const registryDistributionUvxSchema = z.object({
  package: z.string().min(1),
  args: z.array(z.string()).optional(),
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
