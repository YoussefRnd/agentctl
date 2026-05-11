import Fastify from 'fastify';
import worktreePlugin from './plugins/worktree.js';
import websocketPlugin from './plugins/websocket.js';
import { eventsRoutes } from './routes/events.js';
import { serializerCompiler, validatorCompiler } from '@fastify/type-provider-zod';

const fastify = Fastify({
  logger: true,
});

fastify.setValidatorCompiler(validatorCompiler);
fastify.setSerializerCompiler(serializerCompiler);

// Register the Worktree Manager plugin
await fastify.register(worktreePlugin);
await fastify.register(websocketPlugin);
await fastify.register(eventsRoutes);

// Basic route to verify server is up
fastify.get('/health', () => {
  return { status: 'ok' };
});

// Start server
const start = async () => {
  try {
    const port = Number(process.env.PORT) || 3000;
    await fastify.listen({ port, host: '0.0.0.0' });
    fastify.log.info(`Server listening on port ${String(port)}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

void start();
