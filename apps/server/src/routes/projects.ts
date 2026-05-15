import { z } from 'zod';
import { projects, sessions } from '@agentctl/core';
import path from 'node:path';
import type { FastifyPluginCallbackZod } from '@fastify/type-provider-zod';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';

const createProjectSchema = z.object({
  path: z.string().min(1),
});

export const projectsRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/projects',
    {
      schema: {
        body: createProjectSchema,
      },
    },
    async (request, _reply) => {
      const { path: projectPath } = request.body;
      const projectName = path.basename(projectPath);
      const projectId = crypto.randomUUID();

      const [createdProject] = await fastify.db.insert(projects).values({
        id: projectId,
        name: projectName,
        path: projectPath,
      }).returning();

      return {
        project: createdProject,
      };
    },
  );

  fastify.get('/projects', async (_request, _reply) => {
    const allProjects = await fastify.db.select().from(projects);
    const allSessions = await fastify.db.select().from(sessions);

    const result = allProjects.map(p => ({
      ...p,
      sessions: allSessions.filter(s => s.projectId === p.id),
    }));

    return result;
  });

  done();
};
