import { z } from 'zod';
import { sessions, type DriverRegistry } from '@agentctl/core';
import { eq } from 'drizzle-orm';
import type { FastifyPluginCallbackZod } from '@fastify/type-provider-zod';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import { createAgentSession } from '../utils/session-factory.js';
import { AppError } from '../utils/app-error.js';

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

function buildLaunchArgs(
  driver: NonNullable<Awaited<ReturnType<DriverRegistry['getDriver']>>>,
  model: string,
  thinkingEffort: string,
): { command: string; args: string[]; env: Record<string, string> } {
  const extraArgs: string[] = [];
  if (model && model !== 'default') extraArgs.push('--model', model);
  if (thinkingEffort) extraArgs.push('--thinking-effort', thinkingEffort);
  return {
    command: driver.command,
    args: [...extraArgs, ...driver.launchArgs],
    env: driver.launchEnv,
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
    async (request) => {
      return await createAgentSession(fastify, request.body);
    },
  );

  fastify.withTypeProvider<ZodTypeProvider>().get(
    '/sessions/:id',
    {
      schema: {
        params: sessionParamsSchema,
      },
    },
    async (request) => {
      const session = await fastify.db.query.sessions.findFirst({
        where: eq(sessions.id, request.params.id),
      });

      if (!session) {
        throw new AppError('Session not found', 404);
      }

      const drivers = await fastify.driverRegistry.discover();
      return { session, capabilities: drivers };
    },
  );

  fastify.withTypeProvider<ZodTypeProvider>().patch(
    '/sessions/:id/provider',
    {
      schema: {
        params: sessionParamsSchema,
        body: updateSessionProviderSchema,
      },
    },
    async (request) => {
      const session = await fastify.db.query.sessions.findFirst({
        where: eq(sessions.id, request.params.id),
      });

      if (!session) {
        throw new AppError('Session not found', 404);
      }

      const [updatedSession] = await fastify.db
        .update(sessions)
        .set({
          selectedDriver: request.body.selectedDriver,
          selectedModel: request.body.selectedModel,
          selectedThinkingEffort: request.body.selectedThinkingEffort,
        })
        .where(eq(sessions.id, request.params.id))
        .returning();

      const driver = await fastify.driverRegistry.getDriver(updatedSession.selectedDriver);
      if (driver?.status === 'ready') {
        const launch = buildLaunchArgs(
          driver,
          updatedSession.selectedModel,
          updatedSession.selectedThinkingEffort,
        );
        fastify.sessionManager.restartSession(request.params.id, updatedSession.worktreePath, {
          command: launch.command,
          args: launch.args,
          env: launch.env,
        });
      }

      const drivers = await fastify.driverRegistry.discover();
      return { session: updatedSession, capabilities: drivers };
    },
  );

  done();
};
