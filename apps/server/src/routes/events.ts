import type { FastifyPluginCallbackZod } from '@fastify/type-provider-zod';
import { z } from 'zod';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import type { SessionEventRow } from '@agentctl/shared';
import {
  sessionEventRowSchema,
  isSessionEventRow,
  elicitationResponseSchema,
  sessionNoticeSchema,
} from '@agentctl/shared';
import { AppError } from '../errors/app-error.js';
import {
  EVENT_HISTORY_BYTE_BUDGET,
  EVENT_REPLAY_LIMIT,
  parseEventRow,
} from '../services/session-event-history.js';

function formatSSEEvent(event: SessionEventRow, useChangeSequence = false): string {
  return `id: ${String(useChangeSequence ? (event.sequence ?? event.id) : event.id)}\nevent: session_event\ndata: ${JSON.stringify(event)}\n\n`;
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

      return fastify.services.events.list(id);
    },
  );

  fastify
    .withTypeProvider<ZodTypeProvider>()
    .get(
      '/sessions/:id/events/turns',
      { schema: { params: z.object({ id: z.uuid() }) } },
      (request) => {
        return fastify.services.events.turns(request.params.id);
      },
    );

  fastify.withTypeProvider<ZodTypeProvider>().get(
    '/sessions/:id/events/page',
    {
      schema: {
        params: z.object({ id: z.uuid() }),
        querystring: z
          .object({
            beforeId: z.coerce.number().int().positive().optional(),
            aroundId: z.coerce.number().int().positive().optional(),
            afterId: z.coerce.number().int().positive().optional(),
            limit: z.coerce.number().int().min(1).max(500).default(200),
          })
          .refine(
            (query) =>
              [query.beforeId, query.aroundId, query.afterId].filter((id) => id !== undefined)
                .length <= 1,
            'Use one history cursor',
          ),
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const { beforeId, aroundId, afterId, limit } = request.query;
      const controller = new AbortController();
      const abort = () => controller.abort();
      request.raw.once('aborted', abort);
      reply.raw.once('close', abort);
      try {
        const body = await fastify.services.events.pageResponse(
          id,
          { beforeId, aroundId, afterId, limit },
          controller.signal,
        );
        if (body === undefined) throw new AppError('Event not found', 404);
        return reply.type('application/json; charset=utf-8').send(body);
      } catch (error) {
        if (!controller.signal.aborted) throw error;
        return reply;
      } finally {
        request.raw.off('aborted', abort);
        reply.raw.off('close', abort);
      }
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
          snapshots: z.enum(['true']).optional(),
          changes: z.enum(['true']).optional(),
          afterSequence: z.coerce.number().int().nonnegative().optional(),
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

      const useChangeSequence = request.query.changes === 'true';
      const sendEvent = (event: SessionEventRow) => write(formatSSEEvent(event, useChangeSequence));
      let catchingUp = true;
      let pendingBytes = 0;
      const pending: SessionEventRow[] = [];
      let closed = false;
      const write = (frame: string) => {
        if (closed || reply.raw.destroyed || reply.raw.writableEnded) return;
        reply.raw.write(frame);
        // Disconnect a slow reader; its next connection recovers from its cursor.
        if (reply.raw.writableLength > EVENT_HISTORY_BYTE_BUDGET) reply.raw.end();
      };
      // Subscribe before reading the high-water mark so catch-up has no live-event gap.
      const unsubscribe = fastify.eventBus.subscribe(id, (raw) => {
        if (closed || reply.raw.destroyed || reply.raw.writableEnded) return;
        try {
          const notice = sessionNoticeSchema.safeParse(raw);
          if (notice.success) {
            if (notice.data.sessionId === id)
              write(`event: session_notice\ndata: ${JSON.stringify(notice.data)}\n\n`);
            return;
          }
          const event = parseBusEvent(raw);
          if (catchingUp) {
            pendingBytes += Buffer.byteLength(JSON.stringify(event));
            if (pending.length >= EVENT_REPLAY_LIMIT || pendingBytes > EVENT_HISTORY_BYTE_BUDGET) {
              reply.raw.end();
              return;
            }
            pending.push(event);
          } else {
            sendEvent(event);
          }
        } catch (err: unknown) {
          fastify.log.error(err, 'Failed to write live event to stream');
        }
      });
      const heartbeatInterval = setInterval(() => write(':\n\n'), 15000);
      const cleanup = () => {
        closed = true;
        clearInterval(heartbeatInterval);
        unsubscribe();
      };
      reply.raw.on('close', cleanup);
      reply.raw.on('finish', cleanup);

      const lastEventIdHeader = request.headers['last-event-id'];
      const lastEventIdStr =
        (Array.isArray(lastEventIdHeader) ? lastEventIdHeader[0] : lastEventIdHeader) ??
        request.query.lastEventId;
      const lastEventId = lastEventIdStr === undefined ? undefined : Number(lastEventIdStr);
      try {
        if (useChangeSequence) {
          const result = fastify.services.events.changes(id, request.query.afterSequence);
          if (result.snapshot)
            write(
              `id: ${result.snapshot.changeSequence}\nevent: session_snapshot\ndata: ${JSON.stringify(result.snapshot)}\n\n`,
            );
          for (const event of result.events) sendEvent(event);
        } else {
          const highWaterId = await fastify.services.events.highWater(id);
          if (lastEventId !== undefined && Number.isSafeInteger(lastEventId) && lastEventId >= 0) {
            if (request.query.snapshots === 'true') {
              const replay = await fastify.services.events.replay(id, lastEventId, highWaterId);
              if (replay === null) {
                const page = await fastify.services.events.page(id, {
                  limit: 200,
                  throughId: highWaterId,
                });
                write(
                  `id: ${highWaterId}\nevent: session_snapshot\ndata: ${JSON.stringify({ ...page, highWaterId })}\n\n`,
                );
              } else {
                for (const event of replay) sendEvent(event);
              }
            } else {
              // Older clients retain full catch-up, but read it in bounded database batches.
              let cursor = lastEventId;
              while (!closed && !reply.raw.writableEnded) {
                const rows = await fastify.services.events.batch(id, cursor, highWaterId);
                if (rows.length === 0) break;
                for (const row of rows) sendEvent(parseEventRow(row));
                cursor = rows[rows.length - 1].id;
              }
            }
          }
        }
        // Buffered live changes follow persisted replay. Full snapshots then supersede any
        // transient deltas emitted during catch-up, including updates to older event IDs.
        for (const event of pending) sendEvent(event);
        for (const snapshot of session.getLiveEventSnapshots()) sendEvent(parseBusEvent(snapshot));
        pending.length = 0;
        catchingUp = false;
      } catch (err: unknown) {
        fastify.log.error(err, 'Failed to replay missed events');
        write(
          `event: error\ndata: ${JSON.stringify({ error: 'Failed to synchronize session history' })}\n\n`,
        );
        reply.raw.end();
      }
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
        body: elicitationResponseSchema,
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
