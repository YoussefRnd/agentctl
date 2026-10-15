import { customModelsSchema } from '../custom-models.js';
import { z } from 'zod';
import { providerDiscoverySchema, thinkingEffortSchema } from '../schemas/session.js';
import { environmentVariableNameSchema } from '../schemas/registry.js';

const emptyBodySchema = z.record(z.string(), z.unknown()).optional().default({});

export const providersContract = {
  createProfile: {
    method: 'POST',
    path: '/api/providers/:id/profiles',
    pathParams: z.object({ id: z.string() }),
    body: z.object({ name: z.string().trim().min(1).max(100) }),
    responses: { 200: providerDiscoverySchema },
    summary: 'Create a configured provider profile',
  },
  listNativeSessions: {
    method: 'GET',
    path: '/api/providers/:id/native-sessions',
    pathParams: z.object({ id: z.string() }),
    query: z.object({ projectId: z.uuid(), cursor: z.string().optional() }),
    responses: {
      200: z.object({
        sessions: z.array(
          z.object({
            sessionId: z.string(),
            cwd: z.string(),
            title: z.string().optional(),
            updatedAt: z.string().optional(),
            importedSessionId: z.string().optional(),
          }),
        ),
        nextCursor: z.string().optional(),
      }),
    },
    summary: 'List provider native sessions for a project',
  },
  getProviders: {
    method: 'GET',
    path: '/api/providers',
    responses: {
      200: z.array(providerDiscoverySchema),
    },
    summary: 'Discover providers',
  },
  getRegistry: {
    method: 'GET',
    path: '/api/registry',
    responses: {
      200: z.array(providerDiscoverySchema),
    },
    summary: 'Full registry catalog',
  },
  installProvider: {
    method: 'POST',
    path: '/api/providers/:id/install',
    pathParams: z.object({ id: z.string() }),
    body: emptyBodySchema,
    responses: {
      200: providerDiscoverySchema,
    },
    summary: 'Install provider',
  },
  cancelInstallProvider: {
    method: 'POST',
    path: '/api/providers/:id/install/cancel',
    pathParams: z.object({ id: z.string() }),
    body: emptyBodySchema,
    responses: {
      200: z.object({ success: z.boolean() }),
    },
    summary: 'Cancel an in-progress provider installation',
  },
  removeProvider: {
    method: 'POST',
    path: '/api/providers/:id/remove',
    pathParams: z.object({ id: z.string() }),
    body: emptyBodySchema,
    responses: {
      200: providerDiscoverySchema,
    },
    summary: 'Remove provider',
  },
  loginProvider: {
    method: 'POST',
    path: '/api/providers/:id/login',
    pathParams: z.object({ id: z.string() }),
    body: z.object({
      methodId: z.string(),
    }),
    responses: {
      200: z.object({ success: z.boolean() }),
    },
    summary: 'Login to provider',
  },
  respondAuthInteraction: {
    method: 'POST',
    path: '/api/providers/:id/auth/respond',
    pathParams: z.object({ id: z.string() }),
    body: z.object({ interactionId: z.string(), accepted: z.boolean() }),
    responses: { 200: z.object({ success: z.boolean() }) },
    summary: 'Respond to a pending browser authentication request',
  },
  cancelLoginProvider: {
    method: 'POST',
    path: '/api/providers/:id/login/cancel',
    pathParams: z.object({ id: z.string() }),
    body: emptyBodySchema,
    responses: {
      200: z.object({ success: z.boolean() }),
    },
    summary: 'Cancel in-progress login for provider',
  },
  verifyProvider: {
    method: 'POST',
    path: '/api/providers/:id/verify',
    pathParams: z.object({ id: z.string() }),
    body: emptyBodySchema,
    responses: {
      200: providerDiscoverySchema,
    },
    summary: 'Verify provider connection and authentication',
  },
  logoutProvider: {
    method: 'POST',
    path: '/api/providers/:id/logout',
    pathParams: z.object({ id: z.string() }),
    body: emptyBodySchema,
    responses: {
      200: z.object({ success: z.boolean() }),
    },
    summary: 'Logout of provider',
  },
  activateProvider: {
    method: 'POST',
    path: '/api/providers/:id/activate',
    pathParams: z.object({ id: z.string() }),
    body: emptyBodySchema,
    responses: {
      200: providerDiscoverySchema,
    },
    summary: 'Activate provider',
  },
  refreshProvider: {
    method: 'POST',
    path: '/api/providers/:id/refresh',
    pathParams: z.object({ id: z.string() }),
    body: emptyBodySchema,
    responses: {
      200: providerDiscoverySchema,
    },
    summary: 'Refresh provider',
  },
  setProviderConfig: {
    method: 'POST',
    path: '/api/providers/:id/config',
    pathParams: z.object({ id: z.string() }),
    body: z.object({
      customModels: customModelsSchema.optional(),
      customEnv: z.record(environmentVariableNameSchema, z.string()).optional(),
      nativelyLoadsSkills: z.boolean().optional(),
      protocol: z.enum(['auto', 'v1', 'v2']).optional(),
      defaultModel: z.string().optional(),
      defaultThinkingEffort: thinkingEffortSchema.or(z.literal('')).optional(),
    }),
    responses: {
      200: providerDiscoverySchema,
    },
    summary: 'Set provider configuration',
  },
  syncProviders: {
    method: 'POST',
    path: '/api/providers/sync',
    body: emptyBodySchema,
    responses: {
      200: z.array(providerDiscoverySchema),
    },
    summary: 'Sync all providers',
  },
} as const;
