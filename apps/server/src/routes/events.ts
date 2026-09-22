import type { FastifyPluginCallbackZod } from '@fastify/type-provider-zod';
import { z } from 'zod';
import { sessionEvents, sessionEventDbRowSchema } from '@agentctl/core/db';
import { and, asc, eq, gt } from 'drizzle-orm';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import type { SessionEventRow } from '@agentctl/shared';
import { sessionEventRowSchema, isSessionEventRow } from '@agentctl/shared';
import { AppError } from '../errors/app-error.js';

function parseEventRow(rawRow: typeof sessionEvents.$inferSelect): SessionEventRow {
  const row = sessionEventDbRowSchema.parse(rawRow);
  const data: unknown = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
  const metadata: unknown = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : undefined;
  return sessionEventRowSchema.parse({
    ...row,
    data,
    metadata: metadata ?? undefined,
  });
}

function formatSSEEvent(event: SessionEventRow): string {
  return `id: ${String(event.id)}\nevent: session_event\ndata: ${JSON.stringify(event)}\n\n`;
}

function formatStateChange(event: import('@agentctl/shared').StateChangeEvent): string {
  return `id: ${String(event.sequence)}\nevent: state_change\ndata: ${JSON.stringify(event)}\n\n`;
}

function parseBusEvent(raw: unknown): SessionEventRow {
  if (isSessionEventRow(raw)) {
    return raw;
  }
  if (typeof raw === 'object' && raw !== null) {
    const rec = raw as Record<string, unknown>;
    const data: unknown = typeof rec.data === 'string' ? JSON.parse(rec.data) : rec.data;
    const metadata: unknown =
      typeof rec.metadata === 'string' ? JSON.parse(rec.metadata) : rec.metadata;
    return sessionEventRowSchema.parse({
      ...rec,
      data,
      metadata: metadata ?? undefined,
    });
  }
  return sessionEventRowSchema.parse(raw);
}

export const eventsRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.get('/events/stream', async (request, reply) => {
    await reply.hijack();

    if (request.headers.origin) {
      reply.raw.setHeader('Access-Control-Allow-Origin', request.headers.origin);
      reply.raw.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('Transfer-Encoding', 'chunked');
    reply.raw.statusCode = 200;
    reply.raw.write('event: state_ready\ndata: {}\n\n');

    const unsubscribe = fastify.eventBus.subscribeState((event) => {
      if (!reply.raw.destroyed) {
        reply.raw.write(formatStateChange(event));
      }
    });

    const heartbeatInterval = setInterval(() => {
      if (!reply.raw.destroyed) reply.raw.write(':\n\n');
    }, 15000);

    request.raw.on('close', () => {
      clearInterval(heartbeatInterval);
      unsubscribe();
    });
  });

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
        .from(sessionEvents)
        .where(eq(sessionEvents.sessionId, id))
        .orderBy(asc(sessionEvents.id));

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
      if (request.headers.origin) {
        reply.raw.setHeader('Access-Control-Allow-Origin', request.headers.origin);
        reply.raw.setHeader('Access-Control-Allow-Credentials', 'true');
      }
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
              .from(sessionEvents)
              .where(and(eq(sessionEvents.sessionId, id), gt(sessionEvents.id, lastEventId)))
              .orderBy(asc(sessionEvents.id));

            for (const row of missedEvents) {
              if (reply.raw.destroyed) return;
              const parsed = parseEventRow(row);
              reply.raw.write(formatSSEEvent(parsed));
            }
          } catch (err: unknown) {
            fastify.log.error(err, 'Failed to replay missed events');
            if (!reply.raw.destroyed) {
              const msg = err instanceof Error ? err.message : String(err);
              reply.raw.write(`event: error\ndata: ${JSON.stringify({ error: msg })}\n\n`);
            }
          }
        }
      }

      // 6. Subscribe to live events
      const unsubscribe = fastify.eventBus.subscribe(id, (raw) => {
        if (reply.raw.destroyed) return;
        try {
          const parsed = parseBusEvent(raw);
          reply.raw.write(formatSSEEvent(parsed));
        } catch (err: unknown) {
          fastify.log.error(err, 'Failed to write live event to stream');
        }
      });

      // 7. Resync in-flight streaming events after replay: replay rows from
      //    the DB may lag the live transient stream (silent batched flushes),
      //    so emit full-content snapshots for events still streaming. Clients
      //    use these as the base before applying new deltas. Snapshot content
      //    is >= every chunk published before it (computed at emission), so
      //    any delta already delivered is folded into the replacement.
      const snapshots = session.getLiveEventSnapshots();
      for (const snap of snapshots) {
        if (reply.raw.destroyed) return;
        try {
          const parsed = parseBusEvent(snap);
          reply.raw.write(formatSSEEvent(parsed));
        } catch (err: unknown) {
          fastify.log.error(err, 'Failed to write transient snapshot to stream');
        }
      }

      // 8. Keep-alive heartbeat pings
      const heartbeatInterval = setInterval(() => {
        if (!reply.raw.destroyed) {
          reply.raw.write(':\n\n');
        }
      }, 15000);

      // 9. Unsubscribe and cleanup when connection closes
      request.raw.on('close', () => {
        clearInterval(heartbeatInterval);
        unsubscribe();
      });
    },
  );

  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/sessions/:id/elicitations/:elicitationId/respond',
    {
      schema: {
        params: z.object({
          id: z.uuid(),
          elicitationId: z.string(),
        }),
        body: z.object({
          action: z.enum(['submit', 'cancel']),
          values: z.record(z.string(), z.unknown()).optional(),
        }),
      },
    },
    (request) => {
      const { id, elicitationId } = request.params;
      const { action, values } = request.body;

      fastify.sessionService.respondToElicitation(id, elicitationId, {
        action,
        values,
      });

      return { success: true };
    },
  );

  done();
};
