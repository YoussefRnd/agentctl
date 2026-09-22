import fp from 'fastify-plugin';
import type { AuthManager } from '@agentctl/core';

const PUBLIC_PATHS = new Set(['/health', '/api/auth/status', '/api/auth/pairing/consume']);

function isLoopback(ip?: string): boolean {
  if (!ip) return false;
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip === 'localhost';
}

function isSafeMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
}

function isAllowedBrowserOrigin(
  origin: string,
  host: string | undefined,
  configuredOrigins: string | undefined,
): boolean {
  const allowedOrigins = new Set(
    configuredOrigins
      ? configuredOrigins.split(',').map((value) => value.trim())
      : ['http://localhost:5173', 'http://localhost:5174'],
  );
  if (host) {
    allowedOrigins.add(`http://${host}`);
    allowedOrigins.add(`https://${host}`);
  }
  return allowedOrigins.has(origin);
}

export default fp((fastify) => {
  fastify.addHook('onRequest', (request, reply) => {
    const parsedUrl = new URL(request.url, 'http://localhost');
    const pathname = parsedUrl.pathname;

    if (PUBLIC_PATHS.has(pathname)) {
      return Promise.resolve();
    }

    const isDev = fastify.config.NODE_ENV !== 'production';
    const isEmbedded = fastify.embedded;
    const clientIp = request.ip;
    const authManager = fastify.authManager as AuthManager;

    // 1. Local development loopback auto-auth
    if (isDev && isLoopback(clientIp)) {
      return Promise.resolve();
    }

    // 2. Electron uses a per-launch capability kept only in renderer memory.
    const authHeader = request.headers.authorization;
    if (isEmbedded && authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      if (authManager.isDesktopCapability(token)) {
        return Promise.resolve();
      }
    }

    // Browser WebSockets cannot set Authorization, so Electron sends its
    // ephemeral capability as a WebSocket subprotocol instead of leaking it
    // through a query string and request logs.
    if (isEmbedded) {
      const protocols = request.headers['sec-websocket-protocol']
        ?.split(',')
        .map((protocol) => protocol.trim());
      const capabilityProtocol = protocols?.find((protocol) =>
        protocol.startsWith('agentctl.desktop.'),
      );
      const capability = capabilityProtocol?.slice('agentctl.desktop.'.length);
      if (capability && authManager.isDesktopCapability(capability)) {
        return Promise.resolve();
      }
    }

    // 3. Remote browsers authenticate only with a server-backed cookie session.
    const authSessionId = request.session.get('authSessionId');
    if (authSessionId && authManager.validateBrowserSession(authSessionId)) {
      const origin = request.headers.origin;
      if (
        !isSafeMethod(request.method) &&
        origin &&
        !isAllowedBrowserOrigin(origin, request.headers.host, fastify.config.CORS_ALLOWED_ORIGINS)
      ) {
        return reply.code(403).send({ error: 'Origin not allowed' });
      }
      return Promise.resolve();
    }
    if (authSessionId) {
      request.session.delete();
    }

    return reply.code(401).send({ error: 'Unauthorized' });
  });
  return Promise.resolve();
});
