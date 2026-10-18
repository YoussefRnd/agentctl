/// <reference types="electron" />

import { buildApp } from '@agentctl/server/app';
import { registerGracefulShutdown } from '@agentctl/server/lifecycle';
import { Config } from '@agentctl/core/config';
import { randomBytes } from 'node:crypto';
import { startTelemetry } from '@agentctl/server/telemetry';

async function startServer() {
  process.env.NODE_ENV = 'production';
  process.env.AGENTCTL_SESSION_KEY = randomBytes(32).toString('hex');
  process.env.AGENTCTL_SESSION_SALT = randomBytes(8).toString('hex');
  const desktopCapability = randomBytes(32).toString('base64url');
  const env = Config.load();

  // Dynamic port allocation
  env.PORT = 0;

  const telemetry = await startTelemetry('desktop-server');
  let fastify: Awaited<ReturnType<typeof buildApp>>;
  try {
    fastify = await buildApp({ env, embedded: true, desktopCapability });
  } catch (error) {
    await telemetry.shutdown();
    throw error;
  }

  // Standardized graceful shutdown for desktop embedded server
  const shutdown = registerGracefulShutdown(fastify, {
    timeoutMs: 4000,
    onAfterClose: () => telemetry.shutdown(),
  });

  if (process.parentPort) {
    process.parentPort.on('message', (msg: { data?: { type?: string } }) => {
      if (msg?.data?.type === 'shutdown') {
        void shutdown('IPC shutdown');
      }
    });
  }

  const host = '127.0.0.1';
  try {
    await fastify.listen({ port: env.PORT, host });
  } catch (error) {
    await fastify.close().catch(() => undefined);
    await telemetry.shutdown();
    throw error;
  }

  const address = fastify.server.address();
  const port = typeof address === 'object' && address ? address.port : env.PORT;
  // Notify the main Electron process that the server is ready
  process.parentPort.postMessage({
    type: 'ready',
    port,
    secret: desktopCapability,
  });

  fastify.log.info(`Embedded server listening on http://${host}:${port.toString()}`);
}

startServer().catch((err: unknown) => {
  process.stderr.write(`Failed to start embedded server: ${String(err)}\n`);
  process.exit(1);
});
