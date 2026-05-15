import fp from 'fastify-plugin';

const PUBLIC_PATHS = new Set(['/health', '/api/login', '/api/logout']);

export default fp((fastify) => {
  fastify.addHook('onRequest', (request, reply) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;

    if (PUBLIC_PATHS.has(pathname)) {
      return Promise.resolve();
    }

    if (!request.session.get('authenticated')) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    return Promise.resolve();
  });
  return Promise.resolve();
});
