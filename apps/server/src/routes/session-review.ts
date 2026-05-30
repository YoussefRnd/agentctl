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
        with: { project: true },
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

  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/sessions/:id/review/stage',
    {
      schema: {
        params: reviewParamsSchema,
        body: z.object({
          filePath: z.string(),
        }),
      },
    },
    async (request) => {
      const { id } = request.params;
      const { filePath } = request.body;

      const session = await fastify.db.query.sessions.findFirst({
        where: eq(sessions.id, id),
        with: { project: true },
      });

      if (!session) {
        throw new AppError('Session not found', 404);
      }

      const project = await fastify.db.query.projects.findFirst({
        where: eq(projects.id, session.projectId),
      });

      if (!project?.repoRoot) {
        throw new AppError('Project repo root not found', 404);
      }

      await fastify.worktreeManager.stageFile(project.repoRoot, session.worktreePath, filePath);

      return { success: true };
    },
  );

  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/sessions/:id/review/revert',
    {
      schema: {
        params: reviewParamsSchema,
        body: z.object({
          filePath: z.string(),
        }),
      },
    },
    async (request) => {
      const { id } = request.params;
      const { filePath } = request.body;

      const session = await fastify.db.query.sessions.findFirst({
        where: eq(sessions.id, id),
        with: { project: true },
      });

      if (!session) {
        throw new AppError('Session not found', 404);
      }

      const project = await fastify.db.query.projects.findFirst({
        where: eq(projects.id, session.projectId),
      });

      if (!project?.repoRoot) {
        throw new AppError('Project repo root not found', 404);
      }

      await fastify.worktreeManager.revertFile(project.repoRoot, session.worktreePath, filePath);

      return { success: true };
    },
  );

  done();
};
