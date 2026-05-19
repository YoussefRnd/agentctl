import type { FastifyPluginCallbackZod } from '@fastify/type-provider-zod';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import { sessions, projects } from '@agentctl/core';
import { AppError } from '../errors/app-error.js';

const reviewParamsSchema = z.object({
  id: z.uuid(),
});

export const sessionReviewRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.withTypeProvider<ZodTypeProvider>().get(
    '/sessions/:id/review',
    {
      schema: {
        params: reviewParamsSchema,
      },
    },
    async (request) => {
      const { id } = request.params;
      const session = await fastify.db.query.sessions.findFirst({
        where: eq(sessions.id, id),
      });

      if (!session) {
        throw new AppError('Session not found', 404);
      }

      const project = await fastify.db.query.projects.findFirst({
        where: eq(projects.id, session.projectId),
      });

      if (!project?.repoRoot) {
        return { files: [] };
      }

      const files = await fastify.worktreeManager.getReviewFiles(
        project.repoRoot,
        session.worktreePath,
        session.baseCommit,
      );

      return { files };
    },
  );

  done();
};
