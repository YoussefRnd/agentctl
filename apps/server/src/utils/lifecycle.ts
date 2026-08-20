import type { FastifyInstance } from 'fastify';

export interface GracefulShutdownOptions {
  timeoutMs?: number;
  listenToSignals?: boolean;
  onBeforeClose?: (source: string) => Promise<void> | void;
  onAfterClose?: (source: string) => Promise<void> | void;
}

/**
 * Registers a standardized, leak-proof graceful shutdown handler for Fastify.
 * Ensures all Fastify `onClose` hooks (sessions, MCP, DB, providers) are invoked cleanly,
 * and sets an unref'd safety watchdog timer to prevent process hangs.
 */
export function registerGracefulShutdown(
  app: FastifyInstance,
  options: GracefulShutdownOptions = {},
): (source: string) => Promise<void> {
  const timeoutMs = options.timeoutMs ?? 5000;
  let isShuttingDown = false;

  const shutdown = async (source: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    app.log.info(`[Shutdown] Received ${source}, initiating graceful termination...`);

    // Safety watchdog timer to prevent zombie processes / hanging sockets
    const forceTimer = setTimeout(() => {
      app.log.error(`[Shutdown] Graceful shutdown timed out after ${timeoutMs}ms, forcing exit`);
      process.exit(1);
    }, timeoutMs);
    forceTimer.unref();

    try {
      if (options.onBeforeClose) {
        await options.onBeforeClose(source);
      }

      // fastify.close() runs all registered onClose hooks
      await app.close();
      app.log.info('[Shutdown] All server resources and hooks closed cleanly');

      if (options.onAfterClose) {
        await options.onAfterClose(source);
      }

      process.exit(0);
    } catch (err) {
      app.log.error(err, '[Shutdown] Error encountered during termination');
      process.exit(1);
    }
  };

  if (options.listenToSignals !== false) {
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));
  }

  process.on('unhandledRejection', (reason) => {
    app.log.error(reason, '[Process] Unhandled Promise Rejection');
  });

  process.on('uncaughtException', (err) => {
    app.log.error(err, '[Process] Uncaught Exception');
    void shutdown('uncaughtException');
  });

  return shutdown;
}
