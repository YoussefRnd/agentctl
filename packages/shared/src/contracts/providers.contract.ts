import { z } from 'zod';
import { providerDiscoverySchema } from '../schemas/session.js';

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
      params: z.record(z.string(), z.unknown()).optional(),
    }),
    responses: {
      200: z.object({ success: z.boolean() }),
    },
    summary: 'Login to provider',
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
      customEnv: z.record(z.string(), z.string()).optional(),
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
