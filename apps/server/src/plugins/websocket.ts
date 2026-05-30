import fp from 'fastify-plugin';
import fastifyWebsocket from '@fastify/websocket';
import { acpEvents, sessions } from '@agentctl/core';
import { and, asc, eq, gt } from 'drizzle-orm';
import { wsMessageSchema } from '../types.js';
import type { ACPEventRow } from '@agentctl/shared';

function parseEventRow(row: typeof acpEvents.$inferSelect): ACPEventRow {
  const data: unknown = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
  return {
    ...row,
    data: data as ACPEventRow['data'],
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

          const message = wsMessageSchema.parse(JSON.parse(messageText));

          if (message.action === 'subscribe') {
            if (unsubscribe) unsubscribe();

            // Lazy resuscitation of session if not running in memory
            let session = fastify.sessionManager.getSession(message.sessionId);
            if (!session) {
              const sessionRecord = await fastify.db.query.sessions.findFirst({
                where: eq(sessions.id, message.sessionId),
              });
              if (sessionRecord) {
                const provider = await fastify.providerRegistry.ensureProviderReady(
                  sessionRecord.selectedProvider,
                  {
                    force: false,
                  },
                );
                if (provider.status === 'ready' || provider.status === 'needs_auth') {
                  const launch = provider.getLaunchConfig(
                    sessionRecord.selectedModel,
                    sessionRecord.selectedThinkingEffort,
                  );
                  session = fastify.sessionManager.startSession(
                    sessionRecord.id,
                    sessionRecord.worktreePath,
                    launch.command,
                    launch.args,
                    launch.env,
                  );
                }
              }
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
                socket.send(JSON.stringify({ type: 'acp_event', payload: parseEventRow(event) }));
              }
            }

            unsubscribe = fastify.eventBus.subscribe(message.sessionId, (event) => {
              // Event from ACPSession also has string data, parse it
              const parsed = event as unknown as typeof acpEvents.$inferSelect;
              socket.send(JSON.stringify({ type: 'acp_event', payload: parseEventRow(parsed) }));
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
