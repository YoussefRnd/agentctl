import type { FastifyPluginCallbackZod } from '@fastify/type-provider-zod';
import { z } from 'zod';
import { acpEvents } from '@agentctl/core';
import { and, asc, eq, gt } from 'drizzle-orm';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import type { ACPEventRow } from '@agentctl/shared';
import { acpEventRowSchema } from '@agentctl/shared';
import { AppError } from '../errors/app-error.js';

function parseEventRow(row: typeof acpEvents.$inferSelect): ACPEventRow {
  const data: unknown = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
  const metadata: unknown = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : undefined;
  return acpEventRowSchema.parse({
    ...row,
    data,
    metadata: metadata ?? undefined,
  });
}

function formatSSEEvent(event: ACPEventRow): string {
  return `id: ${String(event.id)}\nevent: acp_event\ndata: ${JSON.stringify(event)}\n\n`;
}

function parseBusEvent(raw: unknown): ACPEventRow {
  const row = raw as typeof acpEvents.$inferSelect & { createdAt: Date };
  const data: unknown = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
  const metadata: unknown = row.metadata
    ? typeof row.metadata === 'string'
      ? JSON.parse(row.metadata)
      : row.metadata
    : undefined;
  return acpEventRowSchema.parse({
    ...row,
    data,
    metadata: metadata ?? undefined,
  });
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

      const rows = await fastify.db
        .select()
        .from(acpEvents)
        .where(eq(acpEvents.sessionId, id))
        .orderBy(asc(acpEvents.id));

      return rows.map(parseEventRow);
    },
  );

  fastify.withTypeProvider<ZodTypeProvider>().get(
    '/sessions/:id/events/stream',
    {
      schema: {
        params: z.object({
          id: z.uuid(),
        }),
        querystring: z.object({
          lastEventId: z.string().optional(),
        }),
      },
    },
    async (request, reply) => {
      const { id } = request.params;

      // 1. Lazy resuscitation check
      const session = await fastify.sessionManager.getOrResuscitate(id, { allowArchived: false });
      if (!session) {
        throw new AppError('Session not found or archived', 404);
      }

      // 2. Hijack the response so Fastify does not close the stream
      //    when the async handler returns.
      await reply.hijack();

      // 3. Set headers
      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache');
      reply.raw.setHeader('Connection', 'keep-alive');
      reply.raw.setHeader('Transfer-Encoding', 'chunked');
      reply.raw.statusCode = 200;

      // Flush headers immediately with an initial heartbeat comment
      reply.raw.write(':\n\n');

      // 4. Last-Event-ID event replay from the database
      const lastEventIdHeader = request.headers['last-event-id'];
      const lastEventIdQuery = request.query.lastEventId;
      const lastEventIdStr =
        (Array.isArray(lastEventIdHeader) ? lastEventIdHeader[0] : lastEventIdHeader) ??
        lastEventIdQuery;

      if (lastEventIdStr) {
        const lastEventId = parseInt(lastEventIdStr, 10);
        if (!isNaN(lastEventId)) {
          try {
            const missedEvents = await fastify.db
              .select()
              .from(acpEvents)
              .where(and(eq(acpEvents.sessionId, id), gt(acpEvents.id, lastEventId)))
              .orderBy(asc(acpEvents.id));

            for (const row of missedEvents) {
              const parsed = parseEventRow(row);
              reply.raw.write(formatSSEEvent(parsed));
            }
          } catch (err: unknown) {
            fastify.log.error(err, 'Failed to replay missed events');
            const msg = err instanceof Error ? err.message : String(err);
            reply.raw.write(`event: error\ndata: ${JSON.stringify({ error: msg })}\n\n`);
          }
        }
      }

      // 5. Subscribe to live events
      const unsubscribe = fastify.eventBus.subscribe(id, (raw) => {
        try {
          const parsed = parseBusEvent(raw);
          reply.raw.write(formatSSEEvent(parsed));
        } catch (err: unknown) {
          fastify.log.error(err, 'Failed to write live event to stream');
        }
      });

      // 6. Keep-alive heartbeat pings
      const heartbeatInterval = setInterval(() => {
        if (!reply.raw.destroyed) {
          reply.raw.write(':\n\n');
        }
      }, 15000);

      // 7. Unsubscribe and cleanup when connection closes
      request.raw.on('close', () => {
        clearInterval(heartbeatInterval);
        unsubscribe();
      });
    },
  );

  done();
};
