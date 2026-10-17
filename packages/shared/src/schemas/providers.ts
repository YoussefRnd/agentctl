import { z } from 'zod';
import { customModelsSchema } from '../custom-models.js';
import { registryAgentSchema } from './registry.js';
import {
  agentConfigOptionSchema,
  agentFeaturesSchema,
  capabilitySnapshotSchema,
} from './agent-capabilities.js';
import { authMethodSchema } from './auth-methods.js';
export const providerStatusSchema = z.enum([
  'ready',
  'not_found',
  'error',
  'needs_auth',
  'inactive',
]);

export const providerCapabilitySchema = z.object({
  customModels: customModelsSchema.optional(),
  defaultModel: z.string().optional(),
  defaultThinkingEffort: z.string().optional(),
  id: z.string(),
  label: z.string(),
  status: providerStatusSchema,
  command: z.string(),
  configOptions: z.array(agentConfigOptionSchema).optional(),
  version: z.string().optional(),
  description: z.string().optional(),
  icon: z.string().optional(),
  supportsDynamicModel: z.boolean().optional(),
  supportsDynamicConfig: z.boolean().optional(),
  modes: z.array(z.string()).optional().default([]),
  features: agentFeaturesSchema.optional(),
  snapshot: capabilitySnapshotSchema.optional(),
});

export const installStateSchema = z.enum([
  'not_installed',
  'installing',
  'installed_local',
  'system_available',
  'failed',
]);
export type InstallState = z.infer<typeof installStateSchema>;
export const installStageSchema = z.enum([
  'preparing',
  'downloading',
  'verifying',
  'extracting',
  'activating',
  'connecting',
]);
export type InstallStage = z.infer<typeof installStageSchema>;
export const installSourceSchema = z.enum(['managed', 'system', 'npx', 'uvx']);
export type InstallSource = z.infer<typeof installSourceSchema>;
export const connectionStateSchema = z.enum(['unknown', 'checking', 'ready', 'error']);
export type ConnectionState = z.infer<typeof connectionStateSchema>;

export const authErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
});
export type AuthError = z.infer<typeof authErrorSchema>;

export const canonicalAuthStateSchema = z.enum([
  'unknown',
  'not_required',
  'required',
  'authenticating',
  'verifying',
  'authenticated',
  'error',
]);

export const authStateSchema = z.preprocess((val: unknown) => {
  if (val === 'needs_auth') return 'required';
  return val;
}, canonicalAuthStateSchema);

export type AuthState = z.infer<typeof canonicalAuthStateSchema>;

export const providerDiscoverySchema = z.object({
  customModels: customModelsSchema.optional(),
  authInteraction: z.object({ id: z.string(), url: z.url(), message: z.string() }).optional(),
  registryAgentId: z.string().optional(),
  isProfile: z.boolean().optional(),
  protocol: z.enum(['auto', 'v1', 'v2']).optional(),
  defaultModel: z.string().optional(),
  defaultThinkingEffort: z.string().optional(),
  // Stable public provider fields accepted from older discovery responses
  id: z.string(),
  label: z.string(),
  configOptions: z.array(agentConfigOptionSchema).optional(),
  authMethods: z.array(authMethodSchema).optional().default([]),
  version: z.string().optional(),
  description: z.string().optional(),
  icon: z.string().optional(),
  supportsDynamicModel: z.boolean().optional().default(false),
  supportsDynamicConfig: z.boolean().optional().default(false),
  supportsLogout: z.boolean().optional().default(false),
  features: agentFeaturesSchema.optional(),
  snapshot: capabilitySnapshotSchema.optional(),
  nativelyLoadsSkills: z.boolean().optional().default(false),
  modes: z.array(z.string()).optional(),

  // Installation, connection and authentication state
  installState: installStateSchema.optional(),
  installError: z.string().nullable().optional(),
  installStage: installStageSchema.nullable().optional(),
  installProgress: z
    .object({
      downloadedBytes: z.number().nonnegative(),
      totalBytes: z.number().positive().nullable(),
    })
    .nullable()
    .optional(),
  installSource: installSourceSchema.nullable().optional(),
  installedVersion: z.string().nullable().optional(),
  availableVersion: z.string().optional(),
  updateAvailable: z.boolean().optional().default(false),
  connectionState: connectionStateSchema.optional().default('unknown'),
  authState: authStateSchema.optional().default('unknown'),
  authError: authErrorSchema.nullable().optional(),
  lastVerifiedAt: z.coerce.date().nullable().optional(),
  status: providerStatusSchema.optional(),
  enabled: z.boolean().default(true),
  hidden: z.boolean().optional(),
  agent: registryAgentSchema.optional(),

  // Shared fields
  command: z.string(),
  launchArgs: z.array(z.string()).default([]),
  launchEnv: z.record(z.string(), z.string()).default({}),
  customEnv: z.record(z.string(), z.string()).default({}),
  customEnvConfigured: z.record(z.string(), z.boolean()).optional().default({}),
});

export function getProviderEnvKeys(provider: {
  id: string;
  authMethods?: { type?: string; vars?: { name: string }[] }[] | null;
  customEnv?: Record<string, string>;
  customEnvConfigured?: Record<string, boolean>;
}): string[] {
  const fromMethods =
    provider.authMethods
      ?.filter((m) => m.type === 'env_var')
      .flatMap((m) => m.vars?.map((v) => v.name) ?? []) ?? [];
  const fromConfig = Object.keys(provider.customEnvConfigured ?? {});
  const fromEnv = Object.keys(provider.customEnv ?? {});
  return [...new Set([...fromMethods, ...fromConfig, ...fromEnv])];
}

export function isProviderEnvKeyOptional(
  provider: {
    authMethods?: { type?: string; vars?: { name: string; optional?: boolean }[] }[] | null;
  },
  key: string,
): boolean {
  return (
    provider.authMethods
      ?.filter((method) => method.type === 'env_var')
      .flatMap((method) => method.vars ?? [])
      .some((variable) => variable.name === key && variable.optional === true) ?? false
  );
}

export type ProviderCapability = z.infer<typeof providerCapabilitySchema>;
export type ProviderStatus = z.infer<typeof providerStatusSchema>;
export type ProviderDiscovery = z.infer<typeof providerDiscoverySchema>;
