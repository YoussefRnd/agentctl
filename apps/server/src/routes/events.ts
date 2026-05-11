import type { FastifyPluginCallbackZod } from '@fastify/type-provider-zod';
import { z } from 'zod';
import { db, acpEvents } from '@agentctl/core';
import { asc, eq } from 'drizzle-orm';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';

export const eventsRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.withTypeProvider<ZodTypeProvider>().get(
    '/api/sessions/:id/events',
    {
      schema: {
        params: z.object({
          id: z.uuid(),
        }),
      },
    },
    async (request) => {
      const { id } = request.params;

      return db
        .select()
        .from(acpEvents)
        .where(eq(acpEvents.sessionId, id))
        .orderBy(asc(acpEvents.id));
    }
  );

  done();
};
