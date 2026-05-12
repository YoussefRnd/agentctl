import fp from 'fastify-plugin';
import fastifyWebsocket from '@fastify/websocket';
import { db, acpEvents } from '@agentctl/core';
import { and, asc, eq, gt } from 'drizzle-orm';
import { EventBus } from '../utils/event-bus.js';
import { wsMessageSchema } from '../types.js';

declare module 'fastify' {
  interface FastifyInstance {
    eventBus: EventBus;
  }
}

export default fp(async (fastify) => {
  await fastify.register(fastifyWebsocket);

  const eventBus = new EventBus();
  fastify.decorate('eventBus', eventBus);

  fastify.get('/ws', { websocket: true }, (socket, req) => {
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
              const missedEvents = await db
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
                socket.send(JSON.stringify({ type: 'acp_event', payload: event }));
              }
            }

            unsubscribe = eventBus.subscribe(message.sessionId, (event) => {
              socket.send(JSON.stringify({ type: 'acp_event', payload: event }));
            });
          } else {
            req.server.sessionManager.handleClientMessage(message);
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

