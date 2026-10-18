import { buildApp } from './app.js';
import { Config } from '@agentctl/core/config';
import { registerGracefulShutdown } from './utils/lifecycle.js';
import { startTelemetry } from './observability/runtime.js';

const start = async () => {
  const env = Config.load();
  const telemetry = await startTelemetry('server');
  let fastify: Awaited<ReturnType<typeof buildApp>> | undefined;
  try {
    fastify = await buildApp({ env });
    registerGracefulShutdown(fastify, {
      timeoutMs: 5000,
      onAfterClose: () => telemetry.shutdown(),
    });
    const port = env.PORT;
    const host = process.env.AGENTCTL_HOST ?? '127.0.0.1';

    await fastify.listen({ port, host });
    const startupToken = fastify.authManager.getStartupPairingToken();

    fastify.log.info(`Server listening on http://${host}:${String(port)}`);
    fastify.log.info(
      `Pairing URL: http://${host}:${String(port)}/#pairing=${encodeURIComponent(startupToken)}`,
    );
  } catch (err) {
    fastify?.log.error(err);
    await fastify?.close().catch(() => undefined);
    await telemetry.shutdown();
    if (!fastify) process.stderr.write('AgentCtl server startup failed.\n');
    process.exit(1);
  }
};

void start();
