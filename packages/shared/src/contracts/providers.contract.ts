import { z } from 'zod';
import { providerDiscoverySchema } from '../schemas/session.js';
import { environmentVariableNameSchema } from '../schemas/registry.js';

const emptyBodySchema = z.record(z.string(), z.unknown()).optional().default({});

export const providersContract = {
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
      customEnv: z.record(environmentVariableNameSchema, z.string()).optional(),
      nativelyLoadsSkills: z.boolean().optional(),
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
