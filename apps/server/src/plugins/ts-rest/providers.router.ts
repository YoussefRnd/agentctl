import type { FastifyInstance } from 'fastify';
import type { RouterImplementation } from '@ts-rest/fastify';
import { providersContract } from '@agentctl/shared';

export function createProvidersRouter(
  fastify: FastifyInstance,
): RouterImplementation<typeof providersContract> {
  return {
    getProviders: async () => {
      const providers = await fastify.providerRegistry.discover();
      return {
        status: 200 as const,
        body: providers,
      };
    },
    getRegistry: async () => {
      const providers = await fastify.providerRegistry.catalog();
      return {
        status: 200 as const,
        body: providers,
      };
    },
    installProvider: async ({ params }: { params: { id: string } }) => {
      const { id } = params;
      const result = await fastify.providerRegistry.install(id);
      return {
        status: 200 as const,
        body: result,
      };
    },
    removeProvider: async ({ params }: { params: { id: string } }) => {
      const { id } = params;
      const result = await fastify.providerRegistry.remove(id);
      return {
        status: 200 as const,
        body: result,
      };
    },
    loginProvider: async ({
      params,
      body,
    }: {
      params: { id: string };
      body: { methodId: string; params?: Record<string, unknown> };
    }) => {
      const { id } = params;
      const { methodId, params: loginParams } = body;
      await fastify.providerRegistry.login(id, methodId, loginParams);
      return {
        status: 200 as const,
        body: { success: true },
      };
    },
    logoutProvider: async ({ params }: { params: { id: string } }) => {
      const { id } = params;
      await fastify.providerRegistry.logout(id);
      return {
        status: 200 as const,
        body: { success: true },
      };
    },
    activateProvider: async ({ params }: { params: { id: string } }) => {
      const { id } = params;
      const result = await fastify.providerRegistry.activate(id);
      return {
        status: 200 as const,
        body: result,
      };
    },
    refreshProvider: async ({ params }: { params: { id: string } }) => {
      const { id } = params;
      const result = await fastify.providerRegistry.refreshProvider(id);
      return {
        status: 200 as const,
        body: result,
      };
    },
    setProviderConfig: async ({
      params,
      body,
    }: {
      params: { id: string };
      body: { customEnv?: Record<string, string>; nativelyLoadsSkills?: boolean };
    }) => {
      const { id } = params;
      const { customEnv, nativelyLoadsSkills } = body;
      const result = await fastify.providerRegistry.setProviderConfig(id, {
        customEnv,
        nativelyLoadsSkills,
      });
      return {
        status: 200 as const,
        body: result,
      };
    },
    syncProviders: async () => {
      await fastify.providerRegistry.sync();
      const providers = await fastify.providerRegistry.discover();
      return {
        status: 200 as const,
        body: providers,
      };
    },
  };
}
