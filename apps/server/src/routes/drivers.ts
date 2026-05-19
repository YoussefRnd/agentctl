import type { FastifyPluginCallbackZod } from '@fastify/type-provider-zod';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import { z } from 'zod';

export const driversRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.withTypeProvider<ZodTypeProvider>().get('/drivers', async () => {
    return await fastify.driverRegistry.discover();
  });

  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/drivers/:id/login',
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
      await fastify.driverRegistry.login(id, methodId, params);
      return { success: true };
    },
  );

  done();
};
