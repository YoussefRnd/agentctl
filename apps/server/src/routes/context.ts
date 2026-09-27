import type { FastifyPluginCallback } from 'fastify';
import { sessions, projects } from '@agentctl/core/db';
import { eq } from 'drizzle-orm';
import type { ContextItemType, ContextItemReference } from '@agentctl/core';

export const contextRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.get('/projects/:id/context/search', async (req, reply) => {
    const { id } = req.params as { id: string };
    const query = req.query as { q?: string; type?: 'all' | ContextItemType };
    const project = await fastify.db.query.projects.findFirst({ where: eq(projects.id, id) });
    if (!project) return reply.code(404).send({ error: 'Project not found' });
    return reply.send({
      items: await fastify.contextService.search(project.path, query.q ?? '', query.type ?? 'all'),
    });
  });
  fastify.post('/projects/:id/context/resolve', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { items: ContextItemReference[] };
    if (!Array.isArray(body?.items))
      return reply.code(400).send({ error: 'Missing or invalid items array in request body' });
    const project = await fastify.db.query.projects.findFirst({ where: eq(projects.id, id) });
    if (!project) return reply.code(404).send({ error: 'Project not found' });
    return reply.send(await fastify.contextService.resolve(project.path, body.items));
  });

  // Search workspace context (files, folders, git targets, symbols)
  fastify.get('/sessions/:id/context/search', async (req, reply) => {
    const { id: sessionId } = req.params as { id: string };
    const query = req.query as { q?: string; type?: string };
    const q = query.q || '';
    const filterType = (query.type as 'all' | ContextItemType) || 'all';

    const session = await fastify.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
    });

    if (!session) {
      return reply.code(404).send({ error: `Session not found: ${sessionId}` });
    }

    const project = await fastify.db.query.projects.findFirst({
      where: eq(projects.id, session.projectId),
    });

    const cwd = session.worktreePath || project?.repoRoot || project?.path || process.cwd();
    const items = await fastify.contextService.search(cwd, q, filterType);

    return reply.send({ items });
  });

  // Resolve selected context references into hydrated content
  fastify.post('/sessions/:id/context/resolve', async (req, reply) => {
    const { id: sessionId } = req.params as { id: string };
    const body = req.body as { items: ContextItemReference[] };

    if (!body?.items || !Array.isArray(body.items)) {
      return reply.code(400).send({ error: 'Missing or invalid items array in request body' });
    }

    const session = await fastify.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
    });

    if (!session) {
      return reply.code(404).send({ error: `Session not found: ${sessionId}` });
    }

    const project = await fastify.db.query.projects.findFirst({
      where: eq(projects.id, session.projectId),
    });

    const cwd = session.worktreePath || project?.repoRoot || project?.path || process.cwd();
    const result = await fastify.contextService.resolve(cwd, body.items);

    return reply.send(result);
  });

  done();
};
