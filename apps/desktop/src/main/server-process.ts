/// <reference types="electron" />

import { buildApp } from '@agentctl/server/app';
import { Config } from '@agentctl/core';
import crypto from 'node:crypto';

async function startServer() {
  process.env.NODE_ENV = 'production';
  // Load environment — in packaged app, DATABASE_URL won't be set,
  // so getDbPath() falls back to ~/.agentctl/agentctl.db
  const env = Config.load();

  // Auto-generate a secret for production builds
  if (env.AGENTCTL_SECRET === 'dev-secret') {
    env.AGENTCTL_SECRET = crypto.randomBytes(16).toString('hex');
  }

  // Use port 0 to get a random available port
  env.PORT = 0;

  const fastify = await buildApp({ env, embedded: true });

  const host = '127.0.0.1';
  await fastify.listen({ port: env.PORT, host });

  // Get the actual port assigned by the OS
  const address = fastify.server.address();
  const port = typeof address === 'object' && address ? address.port : env.PORT;

  // Notify the main process that the server is ready
  process.parentPort.postMessage({
    type: 'ready',
    port,
    secret: env.AGENTCTL_SECRET,
  });

  fastify.log.info(`Embedded server listening on ${host}:${port.toString()}`);
  fastify.log.info(`one-time login key: ${env.AGENTCTL_SECRET}`);
}

startServer().catch((err: unknown) => {
  process.stderr.write(`Failed to start embedded server: ${String(err)}\n`);
  process.exit(1);
});
