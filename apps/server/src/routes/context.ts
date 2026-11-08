import type { FastifyPluginCallback } from 'fastify';
import type { ContextItemType, ContextItemReference } from '@agentctl/core';

export const contextRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.get('/projects/:id/context/search', async (req, reply) => {
    const { id } = req.params as { id: string };
    const query = req.query as { q?: string; type?: 'all' | ContextItemType };
    const cwd = await fastify.services.workspaces.projectDirectory(id);
    return reply.send({
      items: await fastify.contextService.search(cwd, query.q ?? '', query.type ?? 'all'),
    });
  });
  fastify.post('/projects/:id/context/resolve', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { items: ContextItemReference[] };
    if (!Array.isArray(body?.items))
      return reply.code(400).send({ error: 'Missing or invalid items array in request body' });
    const cwd = await fastify.services.workspaces.projectDirectory(id);
    return reply.send(await fastify.contextService.resolve(cwd, body.items));
  });

  fastify.get('/sessions/:id/context/search', async (req, reply) => {
    const { id: sessionId } = req.params as { id: string };
    const query = req.query as { q?: string; type?: string };
    const q = query.q || '';
    const filterType = (query.type as 'all' | ContextItemType) || 'all';

    const cwd = await fastify.services.workspaces.sessionDirectory(sessionId, 'context');
    const items = await fastify.contextService.search(cwd, q, filterType);

    return reply.send({ items });
  });

  fastify.post('/sessions/:id/context/resolve', async (req, reply) => {
    const { id: sessionId } = req.params as { id: string };
    const body = req.body as { items: ContextItemReference[] };

    if (!body?.items || !Array.isArray(body.items)) {
      return reply.code(400).send({ error: 'Missing or invalid items array in request body' });
    }

    const cwd = await fastify.services.workspaces.sessionDirectory(sessionId, 'context');
    const result = await fastify.contextService.resolve(cwd, body.items);

    return reply.send(result);
  });

  done();
};
