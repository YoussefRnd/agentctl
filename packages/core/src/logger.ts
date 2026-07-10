/**
 * Minimal logger interface that both Fastify's pino logger and a no-op
 * implementation satisfy. Kept in @agentctl/core so library classes can
 * accept a logger without depending on Fastify or pino directly.
 *
 * Usage in core classes:
 *   constructor(private logger: Logger = noopLogger) {}
 *
 * Usage from the server (Fastify's log is structurally compatible):
 *   new ProviderRegistry(fastify.log)
 */

// Matches pino's two-overload log function shape:
//   log.error(err, 'message')   → structured object + string
//   log.error('message')        → plain string
interface LogFn {
  (obj: unknown, msg?: string): void;
  (msg: string): void;
}

export interface Logger {
  info: LogFn;
  warn: LogFn;
  error: LogFn;
  debug: LogFn;
}

const noop = () => { return; };

/** Silent logger — used as the default when no logger is injected. */
export const noopLogger: Logger = {
  info: noop,
  warn: noop,
  error: noop,
  debug: noop,
};
