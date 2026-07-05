import fp from 'fastify-plugin';

const PUBLIC_PATHS = new Set(['/health', '/api/login', '/api/logout']);

export default fp((fastify) => {
  fastify.addHook('onRequest', (request, reply) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;

    if (PUBLIC_PATHS.has(pathname)) {
      return Promise.resolve();
    }

    // 1. Check session cookie auth
    if (request.session.get('authenticated')) {
      return Promise.resolve();
    }

    // 2. Check Authorization Bearer token auth
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      if (token === fastify.config.AGENTCTL_SECRET) {
        return Promise.resolve();
      }
    }

    return reply.code(401).send({ error: 'Unauthorized' });
  });
  return Promise.resolve();
});
