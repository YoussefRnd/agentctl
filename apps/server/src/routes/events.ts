import type { FastifyPluginCallbackZod } from '@fastify/type-provider-zod';
import { z } from 'zod';
import { db, acpEvents } from '@agentctl/core';
import { asc, eq } from 'drizzle-orm';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import type { ACPEventRow } from '@agentctl/shared';

function parseEventRow(row: typeof acpEvents.$inferSelect): ACPEventRow {
  return {
    ...row,
    data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data,
  };
}

export const eventsRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.withTypeProvider<ZodTypeProvider>().get(
    '/sessions/:id/events',
    {
      schema: {
        params: z.object({
          id: z.uuid(),
        }),
      },
    },
    async (request) => {
      const { id } = request.params;

      const rows = await db
        .select()
        .from(acpEvents)
        .where(eq(acpEvents.sessionId, id))
        .orderBy(asc(acpEvents.id));

      return rows.map(parseEventRow);
    }
  );

  done();
};
