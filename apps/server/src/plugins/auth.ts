import fp from 'fastify-plugin';

export default fp((fastify) => {
  fastify.addHook('onRequest', (request, reply) => {
    // Exempt /health, /ws, and /api/login from auth
    if (
      request.url === '/health' ||
      request.url === '/ws' ||
      request.url === '/api/login'
    ) {
      return Promise.resolve();
    }

    if (!request.session.get('authenticated')) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    return Promise.resolve();
  });
  return Promise.resolve();
});
