import { z } from 'zod';
import { sessions, projects, listDriverCapabilities, resolveProviderSelection, getDriverCapability, type ThinkingEffort } from '@agentctl/core';
import { eq } from 'drizzle-orm';
import type { FastifyPluginCallbackZod } from '@fastify/type-provider-zod';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';

const createSessionSchema = z.object({
  projectId: z.uuid(),
  agent: z.enum(['claude-code', 'gemini-cli', 'opencode', 'codex-acp']),
  taskSlug: z.string().min(1),
});

const updateSessionProviderSchema = z.object({
  selectedDriver: z.enum(['claude-code', 'gemini-cli', 'opencode', 'codex-acp']),
  selectedModel: z.string().min(1),
  selectedThinkingEffort: z.enum(['low', 'medium', 'high']),
});

const sessionParamsSchema = z.object({
  id: z.uuid(),
});

const sessionRowSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  branch: z.string().min(1),
  worktreePath: z.string().min(1),
  taskSlug: z.string().min(1),
  baseCommit: z.string().min(1),
  agent: z.enum(['claude-code', 'gemini-cli', 'opencode', 'codex-acp']),
  agentSessionId: z.string().nullable(),
  status: z.enum(['running', 'needs_attention', 'idle', 'error', 'merged', 'discarded']),
  totalTokens: z.number(),
  contextLimit: z.number(),
  estimatedCost: z.number(),
  lastHeartbeat: z.coerce.date().nullable(),
  closedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  selectedDriver: z.enum(['claude-code', 'gemini-cli', 'opencode', 'codex-acp']),
  selectedModel: z.string().min(1),
  selectedThinkingEffort: z.enum(['low', 'medium', 'high']),
});

const sessionWithCapabilitiesSchema = z.object({
  session: sessionRowSchema,
  capabilities: z.array(z.object({
    driver: z.enum(['claude-code', 'gemini-cli', 'opencode', 'codex-acp']),
    label: z.string().min(1),
    command: z.string().min(1),
    models: z.array(z.string().min(1)),
    thinkingEfforts: z.array(z.enum(['low', 'medium', 'high'])),
  })),
});

function normalizeSessionSelection(session: typeof sessions.$inferSelect) {
  return {
    ...session,
    ...resolveProviderSelection({
    selectedDriver: session.selectedDriver,
    selectedModel: session.selectedModel,
    selectedThinkingEffort: session.selectedThinkingEffort,
    }),
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

      // Create session in DB with real worktree data
      const selection = resolveProviderSelection({ selectedDriver: agent });
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
      const capability = getDriverCapability(createdSession.selectedDriver) ?? getDriverCapability('claude-code');
      if (capability) {
        const args = capability.buildArgs(createdSession.selectedModel, createdSession.selectedThinkingEffort as ThinkingEffort);

        try {
          fastify.sessionManager.startSession(sessionId, createdSession.worktreePath, capability.command, args);
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

      return sessionWithCapabilitiesSchema.parse({
        session: normalizeSessionSelection(session),
        capabilities: listDriverCapabilities(),
      });
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

      const selection = resolveProviderSelection(request.body);
      const [updatedSession] = await fastify.db.update(sessions).set({
        selectedDriver: selection.selectedDriver,
        selectedModel: selection.selectedModel,
        selectedThinkingEffort: selection.selectedThinkingEffort,
      }).where(eq(sessions.id, request.params.id)).returning();

      fastify.sessionManager.restartSession(request.params.id, updatedSession.worktreePath, selection);

      return sessionWithCapabilitiesSchema.parse({
        session: normalizeSessionSelection(updatedSession),
        capabilities: listDriverCapabilities(),
      });
    }
  );

  done();
};
