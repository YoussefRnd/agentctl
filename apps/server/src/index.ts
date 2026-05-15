import { buildApp } from './app.js';
import { Config } from '@agentctl/core';
import crypto from 'node:crypto';

const start = async () => {
  const env = Config.load();

  if (env.AGENTCTL_SECRET === 'dev-secret' && process.env.NODE_ENV === 'production') {
    env.AGENTCTL_SECRET = crypto.randomBytes(16).toString('hex');
  }

  const fastify = await buildApp({ env });
  try {
    const port = env.PORT;
    const host = process.env.AGENTCTL_HOST ?? '127.0.0.1';
    
    await fastify.listen({ port, host });
    
    // eslint-disable-next-line no-console
    console.log(`Server listening on ${host}:${String(port)}`);
    // eslint-disable-next-line no-console
    console.log(`🔑 One-time login key: ${env.AGENTCTL_SECRET}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

void start();
