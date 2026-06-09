import { z } from 'zod';

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
  configOptions: z.array(z.any()).optional(),
  authMethods: z.array(z.any()).optional(),
  supportsDynamicModel: z.boolean().optional(),
  supportsDynamicConfig: z.boolean().optional(),
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
