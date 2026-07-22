import { buildApp } from './app.js';
import { Config } from '@agentctl/core/config';
import crypto from 'node:crypto';

const start = async () => {
  const env = Config.load();

  if (env.AGENTCTL_SECRET === 'dev-secret' && process.env.NODE_ENV === 'production') {
    env.AGENTCTL_SECRET = crypto.randomBytes(16).toString('hex');
  }

  const fastify = await buildApp({ env });

  const shutdown = async (signal: string) => {
    fastify.log.info(`${signal} received, starting graceful shutdown...`);

    // 1. Close Fastify (stops new connections)
    try {
      await fastify.close();
      fastify.log.info('Fastify server closed');
    } catch (err) {
      fastify.log.error(err, 'Error closing Fastify server');
    }

    // 2. Stop all agent sessions
    try {
      await fastify.sessionManager.stopAll();
      fastify.log.info('All agent sessions stopped');
    } catch (err) {
      fastify.log.error(err, 'Error stopping agent sessions');
    }

    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  try {
    const port = env.PORT;
    const host = process.env.AGENTCTL_HOST ?? '127.0.0.1';

    await fastify.listen({ port, host });
    fastify.log.info(`server listening on ${host}:${String(port)}`);
    fastify.log.info(`one-time login key: ${env.AGENTCTL_SECRET}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

void start();
