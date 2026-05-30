import type { FastifyPluginCallbackZod } from '@fastify/type-provider-zod';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import { z } from 'zod';

export const providersRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.withTypeProvider<ZodTypeProvider>().get('/providers', async () => {
    return await fastify.providerRegistry.discover();
  });

  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/providers/:id/login',
    {
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({
          methodId: z.string(),
          params: z.record(z.string(), z.any()).optional(),
        }),
      },
    },
    async (request) => {
      const { id } = request.params;
      const { methodId, params } = request.body;
      await fastify.providerRegistry.login(id, methodId, params);
      return { success: true };
    },
  );
  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/providers/:id/activate',
    {
      schema: {
        params: z.object({ id: z.string() }),
      },
    },
    async (request) => {
      const { id } = request.params;
      return await fastify.providerRegistry.activate(id);
    },
  );

  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/providers/:id/refresh',
    {
      schema: {
        params: z.object({ id: z.string() }),
      },
    },
    async (request) => {
      const { id } = request.params;
      return await fastify.providerRegistry.refreshProvider(id);
    },
  );

  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/providers/:id/toggle',
    {
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({ enabled: z.boolean() }),
      },
    },
    async (request) => {
      const { id } = request.params;
      const { enabled } = request.body;
      return await fastify.providerRegistry.setProviderEnabled(id, enabled);
    },
  );

  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/providers/:id/config',
    {
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({
          customEnv: z.record(z.string(), z.string()),
        }),
      },
    },
    async (request) => {
      const { id } = request.params;
      const { customEnv } = request.body;
      return await fastify.providerRegistry.setProviderConfig(id, customEnv);
    },
  );

  fastify.withTypeProvider<ZodTypeProvider>().post('/providers/sync', async () => {
    await fastify.providerRegistry.sync();
    return await fastify.providerRegistry.discover();
  });
  done();
};
