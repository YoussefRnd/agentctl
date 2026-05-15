import { z } from 'zod';
import { sessions, projects, type DriverRegistry } from '@agentctl/core';
import { eq } from 'drizzle-orm';
import type { FastifyPluginCallbackZod } from '@fastify/type-provider-zod';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import type { ThinkingEffort } from '@agentctl/shared';

const createSessionSchema = z.object({
  projectId: z.uuid(),
  agent: z.string().min(1),
  taskSlug: z.string().min(1),
});

const updateSessionProviderSchema = z.object({
  selectedDriver: z.string().min(1),
  selectedModel: z.string().min(1),
  selectedThinkingEffort: z.enum(['low', 'medium', 'high']),
});

const sessionParamsSchema = z.object({
  id: z.uuid(),
});

async function resolveInitialSelection(driverRegistry: DriverRegistry, driverId: string) {
  const drivers = await driverRegistry.discover();
  const driver = drivers.find(d => d.id === driverId);
  const options = driver?.configOptions ?? [];

  const modelOpt = options.find((o) => o.id === 'model' || o.id === 'selectedModel');
  const thinkingOpt = options.find((o) => o.id === 'thinking' || o.id === 'thinking_effort' || o.id === 'selectedThinkingEffort');

  return {
    selectedDriver: driverId,
    selectedModel: modelOpt?.currentValue ?? 'default',
    selectedThinkingEffort: (thinkingOpt?.currentValue ?? 'medium') as ThinkingEffort,
  };
}

function buildLaunchArgs(driver: NonNullable<Awaited<ReturnType<DriverRegistry['getDriver']>>>, model: string, thinkingEffort: string): { command: string; args: string[]; env: Record<string, string> } {
  const baseArgs = driver.launchArgs;
  const baseEnv = driver.launchEnv;
  const extraArgs: string[] = [];

  if (model && model !== 'default') extraArgs.push('--model', model);
  if (thinkingEffort) extraArgs.push('--thinking-effort', thinkingEffort);

  return {
    command: driver.command,
    args: [...baseArgs, ...extraArgs],
    env: baseEnv,
  };
}

export const sessionsRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/sessions',
    {
      schema: {
        body: createSessionSchema,
      },
    },
    async (request, reply) => {
      const { projectId, agent, taskSlug } = request.body;

      // Verify project exists
      const project = await fastify.db.query.projects.findFirst({
        where: eq(projects.id, projectId),
      });

      if (!project) {
        return reply.code(404).send({ error: 'Project not found' });
      }

      // Generate session ID
      const sessionId = crypto.randomUUID();

      // Create a real worktree
      const worktree = await fastify.worktreeManager.create(project.path, sessionId, taskSlug);

      // Resolve initial selection from driver registry
      const selection = await resolveInitialSelection(fastify.driverRegistry, agent);

      // Create session in DB with real worktree data
      const [createdSession] = await fastify.db.insert(sessions).values({
        id: sessionId,
        projectId,
        branch: worktree.branch,
        worktreePath: worktree.path,
        agent,
        status: 'idle',
        taskSlug,
        baseCommit: worktree.baseCommit,
        ...selection,
      }).returning();

      // Start the session via SessionManager using the resolved provider command.
      const driver = await fastify.driverRegistry.getDriver(createdSession.selectedDriver);
      if (driver?.status === 'ready') {
        const launch = buildLaunchArgs(driver, createdSession.selectedModel, createdSession.selectedThinkingEffort);

        try {
          fastify.sessionManager.startSession(sessionId, createdSession.worktreePath, launch.command, launch.args, launch.env);
        } catch (err) {
          fastify.log.error(err, 'Failed to start session');
          // Session created but failed to start - still return it
        }
      }

      return createdSession;
    }
  );

  fastify.withTypeProvider<ZodTypeProvider>().get(
    '/sessions/:id',
    {
      schema: {
        params: sessionParamsSchema,
      },
    },
    async (request, reply) => {
      const session = await fastify.db.query.sessions.findFirst({
        where: eq(sessions.id, request.params.id),
      });

      if (!session) {
        return reply.code(404).send({ error: 'Session not found' });
      }

      const drivers = await fastify.driverRegistry.discover();

      return {
        session,
        capabilities: drivers,
      };
    }
  );

  fastify.withTypeProvider<ZodTypeProvider>().patch(
    '/sessions/:id/provider',
    {
      schema: {
        params: sessionParamsSchema,
        body: updateSessionProviderSchema,
      },
    },
    async (request, reply) => {
      const session = await fastify.db.query.sessions.findFirst({
        where: eq(sessions.id, request.params.id),
      });

      if (!session) {
        return reply.code(404).send({ error: 'Session not found' });
      }

      const [updatedSession] = await fastify.db.update(sessions).set({
        selectedDriver: request.body.selectedDriver,
        selectedModel: request.body.selectedModel,
        selectedThinkingEffort: request.body.selectedThinkingEffort,
      }).where(eq(sessions.id, request.params.id)).returning();

      const driver = await fastify.driverRegistry.getDriver(updatedSession.selectedDriver);
      if (driver?.status === 'ready') {
        const launch = buildLaunchArgs(driver, updatedSession.selectedModel, updatedSession.selectedThinkingEffort);
        fastify.sessionManager.restartSession(request.params.id, updatedSession.worktreePath, {
          command: launch.command,
          args: launch.args,
          env: launch.env,
        });
      }

      const drivers = await fastify.driverRegistry.discover();

      return {
        session: updatedSession,
        capabilities: drivers,
      };
    }
  );

  done();
};
