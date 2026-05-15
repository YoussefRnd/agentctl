import { z } from 'zod';
import type { FastifyPluginCallbackZod } from '@fastify/type-provider-zod';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';

const loginSchema = z.object({
  secret: z.string().min(1),
});

export const authRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/login',
    {
      schema: {
        body: loginSchema,
      },
    },
    async (request, reply) => {
      const { secret } = request.body;
      if (secret === fastify.config.AGENTCTL_SECRET) {
        request.session.set('authenticated', true);
        request.session.options({ maxAge: 24 * 60 * 60 });
        return { success: true };
      }
      return reply.code(401).send({ error: 'Invalid secret' });
    },
  );

  fastify.withTypeProvider<ZodTypeProvider>().post('/logout', (request) => {
    request.session.delete();
    return { success: true };
  });

  done();
};
