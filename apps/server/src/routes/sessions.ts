import { z } from 'zod';
import { db, sessions, projects } from '@agentctl/core';
import { eq } from 'drizzle-orm';
import type { FastifyPluginCallbackZod } from '@fastify/type-provider-zod';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';

const createSessionSchema = z.object({
  projectId: z.uuid(),
  agent: z.enum(['claude-code', 'gemini-cli', 'opencode', 'codex-acp']),
  taskSlug: z.string().min(1),
});

export const sessionsRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/api/sessions',
    {
      schema: {
        body: createSessionSchema,
      },
    },
    async (request, reply) => {
      const { projectId, agent, taskSlug } = request.body;

      // Verify project exists
      const project = await db.query.projects.findFirst({
        where: eq(projects.id, projectId),
      });

      if (!project) {
        return reply.code(404).send({ error: 'Project not found' });
      }

      // Generate session ID and branch name
      const sessionId = crypto.randomUUID();
      const branch = `agent/${taskSlug}`;

      // Create session in DB
      const [createdSession] = await db.insert(sessions).values({
        id: sessionId,
        projectId,
        branch,
        worktreePath: `${project.path}/.agentctl/worktrees/${taskSlug}`,
        agent,
        status: 'idle',
        taskSlug,
        baseCommit: 'HEAD',
      }).returning();

      // Start the session via SessionManager
      // Command and args would come from AGENT_DRIVERS config in a full impl
      // For now, using placeholder command
      const command = agent === 'claude-code' ? 'claude' : 'echo';
      const args = ['Agent not fully configured yet'];

      try {
        fastify.sessionManager.startSession(sessionId, createdSession.worktreePath, command, args);
      } catch (err) {
        fastify.log.error(err, 'Failed to start session');
        // Session created but failed to start - still return it
      }

      return createdSession;
    }
  );

  done();
};