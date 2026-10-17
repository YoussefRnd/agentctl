import { z } from 'zod';
import { agentFeaturesSchema, agentConfigOptionSchema } from './agent-capabilities.js';
import { authMethodSchema, environmentVariableNameSchema } from './auth-methods.js';
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

export * from './agent-capabilities.js';
export * from './auth-methods.js';
