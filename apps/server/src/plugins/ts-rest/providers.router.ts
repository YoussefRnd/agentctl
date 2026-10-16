import type { FastifyInstance } from 'fastify';
import type { RouterImplementation } from '@ts-rest/fastify';
import { AppError } from '../../errors/app-error.js';
import { providersContract } from '@agentctl/shared';

export function createProvidersRouter(
  fastify: FastifyInstance,
): RouterImplementation<typeof providersContract> {
  const providerChanged = <T>(body: T) => {
    fastify.eventBus.publishState({ topics: ['providers'] });
    return { status: 200 as const, body };
  };
  return {
    respondAuthInteraction: async ({ params, body }) => {
      const success = fastify.providerRegistry
        .getAuthCoordinator()
        .respondAuthInteraction(params.id, body.interactionId, body.accepted);
      if (!success) throw new AppError('Authentication request expired or already answered', 409);
      return { status: 200 as const, body: { success } };
    },
    createProfile: async ({ params, body }) => ({
      status: 200 as const,
      body: await fastify.providerRegistry.createProfile(params.id, body.name),
    }),
    listNativeSessions: async ({ params, query }) => {
      return { status: 200, body: await fastify.services.providerSessions.list(params.id, query) };
    },
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
    installProvider: async ({ params }) => {
      const { id } = params;
      const result = await fastify.providerRegistry.install(id);
      return providerChanged(result);
    },
    cancelInstallProvider: async ({ params }) => {
      fastify.providerRegistry.cancelInstall(params.id);
      return providerChanged({ success: true });
    },
    removeProvider: async ({ params }) => {
      const { id } = params;
      const result = await fastify.providerRegistry.remove(id);
      return providerChanged(result);
    },
    loginProvider: async ({ params, body }) => {
      const { id } = params;
      const { methodId } = body;
      await fastify.providerRegistry.login(id, methodId);
      return providerChanged({ success: true });
    },
    cancelLoginProvider: async ({ params }) => {
      const { id } = params;
      fastify.providerRegistry.cancelLogin(id);
      return providerChanged({ success: true });
    },
    verifyProvider: async ({ params }) => {
      const { id } = params;
      const result = await fastify.providerRegistry.verify(id);
      return providerChanged(result);
    },
    logoutProvider: async ({ params }) => {
      const { id } = params;
      await fastify.providerRegistry.logout(id);
      return providerChanged({ success: true });
    },
    activateProvider: async ({ params }) => {
      const { id } = params;
      const result = await fastify.providerRegistry.activate(id);
      return providerChanged(result);
    },
    refreshProvider: async ({ params }) => {
      const { id } = params;
      const result = await fastify.providerRegistry.refreshProvider(id);
      return providerChanged(result);
    },
    setProviderConfig: async ({ params, body }) => {
      const result = await fastify.providerRegistry.setProviderConfig(params.id, body);
      return providerChanged(result);
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
