import { buildApp } from './app.js';
import { Config } from '@agentctl/core/config';
import { registerGracefulShutdown } from './utils/lifecycle.js';

const start = async () => {
  const env = Config.load();
  const fastify = await buildApp({ env });

  // Standardized, leak-proof graceful shutdown with 5s watchdog
  registerGracefulShutdown(fastify, { timeoutMs: 5000 });

  try {
    const port = env.PORT;
    const host = process.env.AGENTCTL_HOST ?? '127.0.0.1';

    await fastify.listen({ port, host });
    const startupToken = fastify.authManager.getStartupPairingToken();

    fastify.log.info(`Server listening on http://${host}:${String(port)}`);
    fastify.log.info(
      `Pairing URL: http://${host}:${String(port)}/#pairing=${encodeURIComponent(startupToken)}`,
    );
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

void start();
