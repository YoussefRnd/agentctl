import fp from 'fastify-plugin';

const PUBLIC_PATHS = new Set([
  '/health',
  '/api/login',
  '/api/logout',
  '/api/auth/status',
  '/api/auth/pairing/consume',
]);

function isLoopback(ip?: string): boolean {
  if (!ip) return false;
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip === 'localhost';
}

export default fp((fastify) => {
  fastify.addHook('onRequest', (request, reply) => {
    const parsedUrl = new URL(request.url, 'http://localhost');
    const pathname = parsedUrl.pathname;

    if (PUBLIC_PATHS.has(pathname)) {
      return Promise.resolve();
    }

    const isDev = process.env.NODE_ENV !== 'production';
    const isEmbedded = fastify.embedded;
    const clientIp = request.ip;
    const authManager = fastify.authManager;

    // 1. Desktop embedded mode & Local dev loopback auto-auth
    if (isEmbedded && isLoopback(clientIp)) {
      return Promise.resolve();
    }

    if (isDev && isLoopback(clientIp)) {
      return Promise.resolve();
    }

    // 2. Check session cookie auth
    if (request.session.get('authenticated')) {
      return Promise.resolve();
    }

    // 3. Check Authorization Bearer token auth (Client session token or startup token)
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      if (token === authManager.getStartupToken()) {
        return Promise.resolve();
      }
      const validation = authManager.validateSessionToken(token);
      if (validation.valid) {
        return Promise.resolve();
      }
      if (isDev && token === 'dev-secret') {
        return Promise.resolve();
      }
    }

    // 4. Check custom header x-agentctl-token or x-agentctl-secret
    const customHeaderToken =
      (request.headers['x-agentctl-token'] as string | undefined) ||
      (request.headers['x-agentctl-secret'] as string | undefined);

    if (customHeaderToken) {
      if (customHeaderToken === authManager.getStartupToken()) {
        return Promise.resolve();
      }
      const validation = authManager.validateSessionToken(customHeaderToken);
      if (validation.valid) {
        return Promise.resolve();
      }
    }

    // 5. Check URL query token (for pairing links)
    const queryToken = parsedUrl.searchParams.get('token');
    if (queryToken) {
      try {
        const result = authManager.consumePairingToken(queryToken, {
          userAgent: request.headers['user-agent'],
          ip: clientIp,
        });
        request.session.set('authenticated', true);
        reply.header('x-agentctl-session-token', result.sessionToken);
        return Promise.resolve();
      } catch {
        // Pairing token expired or invalid
      }
    }

    return reply.code(401).send({ error: 'Unauthorized' });
  });
  return Promise.resolve();
});
