/// <reference types="electron" />

import { buildApp } from '@agentctl/server/app';
import { registerGracefulShutdown } from '@agentctl/server/lifecycle';
import { Config } from '@agentctl/core/config';

async function startServer() {
  process.env.NODE_ENV = 'production';
  const env = Config.load();

  // Dynamic port allocation
  env.PORT = 0;

  const fastify = await buildApp({ env, embedded: true });

  // Standardized graceful shutdown for desktop embedded server
  const shutdown = registerGracefulShutdown(fastify, { timeoutMs: 4000 });

  if (process.parentPort) {
    process.parentPort.on('message', (msg: { data?: { type?: string } }) => {
      if (msg?.data?.type === 'shutdown') {
        void shutdown('IPC shutdown');
      }
    });
  }

  const host = '127.0.0.1';
  await fastify.listen({ port: env.PORT, host });

  const address = fastify.server.address();
  const port = typeof address === 'object' && address ? address.port : env.PORT;
  const startupToken = fastify.authManager.getStartupToken();

  // Notify the main Electron process that the server is ready
  process.parentPort.postMessage({
    type: 'ready',
    port,
    secret: startupToken,
  });

  fastify.log.info(`Embedded server listening on http://${host}:${port.toString()}`);
  fastify.log.info(`Startup pairing token: ${startupToken}`);
}

startServer().catch((err: unknown) => {
  process.stderr.write(`Failed to start embedded server: ${String(err)}\n`);
  process.exit(1);
});
