import fp from 'fastify-plugin';
import fastifyWebsocket from '@fastify/websocket';
import { acpEvents } from '@agentctl/core';
import { and, asc, eq, gt } from 'drizzle-orm';
import { clientActionSchema, createEvent } from '@agentctl/shared';
import type { ACPEventRow } from '@agentctl/shared';

function parseEventRow(row: typeof acpEvents.$inferSelect): ACPEventRow {
  const data: unknown = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
  const metadata: unknown = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : undefined;
  return {
    ...row,
    data: data as ACPEventRow['data'],
    metadata: metadata as ACPEventRow['metadata'],
  } as unknown as ACPEventRow;
}

export default fp(async (fastify) => {
  await fastify.register(fastifyWebsocket);

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

          const message = clientActionSchema.parse(JSON.parse(messageText));

          if (message.action === 'subscribe') {
            if (unsubscribe) unsubscribe();

            // Lazy resuscitation of session if not running in memory
            try {
              await fastify.sessionManager.getOrResuscitate(message.sessionId, { allowArchived: false });
            } catch (err) {
              fastify.log.error(err, `Failed to resuscitate session: ${message.sessionId}`);
              socket.send(
                createEvent('error', {
                  error: `Failed to resuscitate session: ${err instanceof Error ? err.message : String(err)}`,
                }),
              );
              return;
            }

            if (message.lastEventId !== undefined) {
              const missedEvents = await fastify.db
                .select()
                .from(acpEvents)
                .where(
                  and(
                    eq(acpEvents.sessionId, message.sessionId),
                    gt(acpEvents.id, message.lastEventId),
                  ),
                )
                .orderBy(asc(acpEvents.id));

              for (const event of missedEvents) {
                socket.send(createEvent('acp_event', parseEventRow(event)));
              }
            }

            unsubscribe = fastify.eventBus.subscribe(message.sessionId, (event) => {
              // Event from ACPSession also has string data, parse it
              const parsed = event as unknown as typeof acpEvents.$inferSelect;
              socket.send(createEvent('acp_event', parseEventRow(parsed)));
            });
          } else {
            await req.server.sessionManager.handleClientMessage(
              message.sessionId,
              message.action,
              message,
            );
          }
        } catch (error) {
          req.log.error(error, 'WebSocket message error');
          socket.send(createEvent('error', { error: 'Invalid message' }));
        }
      };

      void handleMessage();
    });

    socket.on('close', () => {
      if (unsubscribe) unsubscribe();
    });
  });
});
