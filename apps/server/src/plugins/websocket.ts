import fp from 'fastify-plugin';
import fastifyWebsocket from '@fastify/websocket';
import { acpEvents } from '@agentctl/core';
import { and, asc, eq, gt } from 'drizzle-orm';
import { EventBus } from '../utils/event-bus.js';
import { wsMessageSchema } from '../types.js';
import type { ACPEventRow } from '@agentctl/shared';

declare module 'fastify' {
  interface FastifyInstance {
    eventBus: EventBus;
  }
}

function parseEventRow(row: typeof acpEvents.$inferSelect): ACPEventRow {
  return {
    ...row,
    data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data,
  };
}

export default fp(async (fastify) => {
  await fastify.register(fastifyWebsocket);

  const eventBus = new EventBus();
  fastify.decorate('eventBus', eventBus);

  fastify.get('/ws', { websocket: true }, (socket, req) => {
    if (!req.session.get('authenticated')) {
      socket.close();
      return;
    }

    let unsubscribe: (() => void) | null = null;

    socket.on('message', (rawMessage) => {
      const handleMessage = async () => {
        try {
          const messageText = Buffer.isBuffer(rawMessage)
            ? rawMessage.toString()
            : Array.isArray(rawMessage)
              ? Buffer.concat(rawMessage).toString()
              : rawMessage instanceof ArrayBuffer
                ? Buffer.from(rawMessage).toString()
                : String(rawMessage);

          const message = wsMessageSchema.parse(JSON.parse(messageText));

          if (message.action === 'subscribe') {
            if (unsubscribe) unsubscribe();

            if (message.lastEventId !== undefined) {
              const missedEvents = await fastify.db
                .select()
                .from(acpEvents)
                .where(
                  and(
                    eq(acpEvents.sessionId, message.sessionId),
                    gt(acpEvents.id, message.lastEventId)
                  )
                )
                .orderBy(asc(acpEvents.id));

              for (const event of missedEvents) {
                socket.send(JSON.stringify({ type: 'acp_event', payload: parseEventRow(event) }));
              }
            }

            unsubscribe = eventBus.subscribe(message.sessionId, (event) => {
              // Event from session-runner also has string data, parse it
              const parsed = event as unknown as typeof acpEvents.$inferSelect;
              socket.send(JSON.stringify({ type: 'acp_event', payload: parseEventRow(parsed) }));
            });
          } else {
            await req.server.sessionManager.handleClientMessage(message);
          }
        } catch (error) {
          req.log.error(error, 'WebSocket message error');
          socket.send(JSON.stringify({ error: 'Invalid message' }));
        }
      };

      void handleMessage();
    });

    socket.on('close', () => {
      if (unsubscribe) unsubscribe();
    });
  });
});
