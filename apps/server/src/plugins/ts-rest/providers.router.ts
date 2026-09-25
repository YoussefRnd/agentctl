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
      fastify.eventBus.publishState({ topics: ['providers'] });
      return {
        status: 200 as const,
        body: result,
      };
    },
    cancelInstallProvider: async ({ params }: { params: { id: string } }) => {
      fastify.providerRegistry.cancelInstall(params.id);
      fastify.eventBus.publishState({ topics: ['providers'] });
      return { status: 200 as const, body: { success: true } };
    },
    removeProvider: async ({ params }: { params: { id: string } }) => {
      const { id } = params;
      const result = await fastify.providerRegistry.remove(id);
      fastify.eventBus.publishState({ topics: ['providers'] });
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
      body: { methodId: string };
    }) => {
      const { id } = params;
      const { methodId } = body;
      await fastify.providerRegistry.login(id, methodId);
      fastify.eventBus.publishState({ topics: ['providers'] });
      return {
        status: 200 as const,
        body: { success: true },
      };
    },
    cancelLoginProvider: async ({ params }: { params: { id: string } }) => {
      const { id } = params;
      fastify.providerRegistry.cancelLogin(id);
      fastify.eventBus.publishState({ topics: ['providers'] });
      return {
        status: 200 as const,
        body: { success: true },
      };
    },
    verifyProvider: async ({ params }: { params: { id: string } }) => {
      const { id } = params;
      const result = await fastify.providerRegistry.verify(id);
      fastify.eventBus.publishState({ topics: ['providers'] });
      return {
        status: 200 as const,
        body: result,
      };
    },
    logoutProvider: async ({ params }: { params: { id: string } }) => {
      const { id } = params;
      await fastify.providerRegistry.logout(id);
      fastify.eventBus.publishState({ topics: ['providers'] });
      return {
        status: 200 as const,
        body: { success: true },
      };
    },
    activateProvider: async ({ params }: { params: { id: string } }) => {
      const { id } = params;
      const result = await fastify.providerRegistry.activate(id);
      fastify.eventBus.publishState({ topics: ['providers'] });
      return {
        status: 200 as const,
        body: result,
      };
    },
    refreshProvider: async ({ params }: { params: { id: string } }) => {
      const { id } = params;
      const result = await fastify.providerRegistry.refreshProvider(id);
      fastify.eventBus.publishState({ topics: ['providers'] });
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
      fastify.eventBus.publishState({ topics: ['providers'] });
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
