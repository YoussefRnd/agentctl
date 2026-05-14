import { z } from 'zod';
import { projects, sessions, resolveProviderSelection, getDriverCapability } from '@agentctl/core';
import path from 'node:path';
import type { FastifyPluginCallbackZod } from '@fastify/type-provider-zod';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';

const driverSchema = z.enum(['claude-code', 'gemini-cli', 'opencode', 'codex-acp']);
const createProjectSchema = z.object({
  path: z.string().min(1),
  selectedDriver: driverSchema,
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
      const { path: projectPath, selectedDriver } = request.body;
      const projectName = path.basename(projectPath);
      const projectId = crypto.randomUUID();
      const sessionId = crypto.randomUUID();
      const taskSlug = 'new-session';

      const [createdProject] = await fastify.db.insert(projects).values({
        id: projectId,
        name: projectName,
        path: projectPath,
      }).returning();

      const [createdSession] = await fastify.db.insert(sessions).values({
        id: sessionId,
        projectId,
        branch: `agent/${taskSlug}`,
        worktreePath: `${projectPath}/.agentctl/worktrees/${taskSlug}`,
        taskSlug,
        title: 'new session',
        baseCommit: 'HEAD',
        agent: selectedDriver,
        ...resolveProviderSelection({ selectedDriver }),
        status: 'idle',
      }).returning();

      const capability = getDriverCapability(selectedDriver);
      const command = capability?.command ?? 'claude';
      fastify.sessionManager.startSession(
        createdSession.id,
        createdSession.worktreePath,
        command,
        [createdSession.selectedModel, createdSession.selectedThinkingEffort],
      );

      return {
        project: createdProject,
        sessionId: createdSession.id,
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
