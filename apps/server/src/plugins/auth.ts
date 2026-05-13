import fp from 'fastify-plugin';

export default fp((fastify) => {
  fastify.addHook('onRequest', (request, reply) => {
    // Exempt /health and /ws from auth
    // /ws: WebSocket upgrade requests can't set custom Authorization headers
    if (request.url === '/health' || request.url === '/ws') return Promise.resolve();

    // For a local tool, passing the token via header is common
    const token = request.headers.authorization;
    const secret = process.env.AGENTCTL_SECRET;

    // If no secret is configured, warn but allow (or strictly deny depending on prod mindset, let's strictly require it)
    if (!secret) {
      request.log.warn('AGENTCTL_SECRET is not set. All authenticated routes will fail.');
      return reply.code(401).send({ error: 'Server misconfigured: missing secret' });
    }

    if (token !== `Bearer ${secret}`) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    return Promise.resolve();
  });
  return Promise.resolve();
});
