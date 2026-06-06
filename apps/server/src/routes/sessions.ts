import { z } from 'zod';
import { sessions, projects, GitService } from '@agentctl/core';
import { eq } from 'drizzle-orm';
import type { FastifyPluginCallbackZod } from '@fastify/type-provider-zod';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import { AppError } from '../errors/app-error.js';
import { sessionModeSchema } from '@agentctl/shared';

const gitService = new GitService();

const createSessionSchema = z.object({
  projectId: z.uuid(),
  agent: z.string().min(1),
  taskSlug: z.string().min(1),
  mode: sessionModeSchema.optional(),
});

const updateSessionProviderSchema = z.object({
  selectedProvider: z.string().min(1),
  selectedModel: z.string().min(1),
  selectedThinkingEffort: z.enum(['low', 'medium', 'high']),
});

const sessionParamsSchema = z.object({
  id: z.uuid(),
});

export const sessionsRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/sessions',
    {
      schema: {
        body: createSessionSchema,
      },
    },
    async (request) => {
      try {
        const session = await fastify.sessionOrchestrator.create({
          projectId: request.body.projectId,
          providerId: request.body.agent,
          taskSlug: request.body.taskSlug,
          mode: request.body.mode,
        });

        // Return the created session record from the database
        const sessionRecord = await fastify.db.query.sessions.findFirst({
          where: eq(sessions.id, session.sessionId),
          with: { project: true },
        });

        if (!sessionRecord) {
          throw new AppError('Failed to retrieve created session', 500);
        }

        return sessionRecord;
      } catch (err) {
        if (err instanceof Error) {
          if (err.message.includes('not found')) {
            throw new AppError(err.message, 404);
          }
          if (err.message.includes('not ready')) {
            throw new AppError(err.message, 400);
          }
        }
        throw err;
      }
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
        with: { project: true },
      });

      if (!session) {
        throw new AppError('Session not found', 404);
      }

      const providersList = await fastify.providerRegistry.discover();
      return { session, capabilities: providersList };
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
        with: { project: true },
      });

      if (!session) {
        throw new AppError('Session not found', 404);
      }

      const [updatedSession] = await fastify.db
        .update(sessions)
        .set({
          selectedProvider: request.body.selectedProvider,
          selectedModel: request.body.selectedModel,
          selectedThinkingEffort: request.body.selectedThinkingEffort,
        })
        .where(eq(sessions.id, request.params.id))
        .returning();

      const provider = await fastify.providerRegistry.ensureProviderReady(
        updatedSession.selectedProvider,
        {
          force: false,
        },
      );

      if (provider.status === 'ready' || provider.status === 'needs_auth') {
        const launch = provider.getLaunchConfig(
          updatedSession.selectedModel,
          updatedSession.selectedThinkingEffort,
        );
        fastify.sessionManager.restartSession(request.params.id, updatedSession.worktreePath, {
          command: launch.command,
          args: launch.args,
          env: launch.env,
        });
      }

      const providersList = await fastify.providerRegistry.discover();
      return { session: updatedSession, capabilities: providersList };
    },
  );

  fastify.withTypeProvider<ZodTypeProvider>().get(
    '/sessions/:id/branches',
    {
      schema: {
        params: sessionParamsSchema,
      },
    },
    async (request) => {
      const session = await fastify.db.query.sessions.findFirst({
        where: eq(sessions.id, request.params.id),
        with: { project: true },
      });

      if (!session) {
        throw new AppError('Session not found', 404);
      }

      const project = await fastify.db.query.projects.findFirst({
        where: eq(projects.id, session.projectId),
      });

      if (!project?.repoRoot) {
        return [];
      }

      try {
        return await gitService.listBranches(project.repoRoot);
      } catch (err) {
        throw new AppError(err instanceof Error ? err.message : 'Failed to list branches', 500);
      }
    },
  );

  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/sessions/:id/branch',
    {
      schema: {
        params: sessionParamsSchema,
        body: z.object({
          branch: z.string().min(1),
        }),
      },
    },
    async (request) => {
      const session = await fastify.db.query.sessions.findFirst({
        where: eq(sessions.id, request.params.id),
        with: { project: true },
      });

      if (!session) {
        throw new AppError('Session not found', 404);
      }

      try {
        // Checkout the branch in the worktree
        await gitService.checkout(session.worktreePath, request.body.branch);

        // Update database
        const [updatedSession] = await fastify.db
          .update(sessions)
          .set({
            branch: request.body.branch,
          })
          .where(eq(sessions.id, request.params.id))
          .returning();

        // If session is running, restart the connection to reload new state
        const activeSession = fastify.sessionManager.getSession(request.params.id);
        if (activeSession) {
          const provider = await fastify.providerRegistry.ensureProviderReady(
            updatedSession.selectedProvider,
            {
              force: false,
            },
          );
          if (provider.status === 'ready' || provider.status === 'needs_auth') {
            const launch = provider.getLaunchConfig(
              updatedSession.selectedModel,
              updatedSession.selectedThinkingEffort,
            );
            fastify.sessionManager.restartSession(request.params.id, updatedSession.worktreePath, {
              command: launch.command,
              args: launch.args,
              env: launch.env,
            });
          }
        }

        return updatedSession;
      } catch (err) {
        throw new AppError(err instanceof Error ? err.message : 'Failed to change branch', 500);
      }
    },
  );

  fastify.withTypeProvider<ZodTypeProvider>().patch(
    '/sessions/:id/mode',
    {
      schema: {
        params: sessionParamsSchema,
        body: z.object({ mode: sessionModeSchema }),
      },
    },
    async (request) => {
      const session = await fastify.db.query.sessions.findFirst({
        where: eq(sessions.id, request.params.id),
        with: { project: true },
      });

      if (!session) {
        throw new AppError('Session not found', 404);
      }

      const project = await fastify.db.query.projects.findFirst({
        where: eq(projects.id, session.projectId),
      });

      if (!project) {
        throw new AppError('Project not found', 404);
      }

      const newMode = request.body.mode;
      let worktreePath = session.worktreePath;
      let branch = session.branch;
      let baseCommit = session.baseCommit;

      try {
        if (newMode === 'worktree' && session.mode === 'local') {
          if (!project.repoRoot) {
            throw new AppError('Project repo root not set. Cannot create worktree.', 400);
          }
          // Switching from local to worktree
          const result = await fastify.worktreeManager.create(
            project.repoRoot,
            session.id,
            session.taskSlug,
            session.branch || 'main',
          );
          worktreePath = result.path;
          branch = result.branch;
          baseCommit = result.baseCommit;
        } else if (newMode === 'local' && session.mode === 'worktree') {
          if (!project.repoRoot) {
            throw new AppError('Project repo root not set. Cannot switch to local mode.', 400);
          }
          // Switching from worktree to local
          worktreePath = project.repoRoot;
          // Optionally: cleanup the worktree if we want to be tidy,
          // but maybe better to keep it if we might switch back.
          // For now, we just update the path to the main repo root.
        }

        const [updatedSession] = await fastify.db
          .update(sessions)
          .set({
            mode: newMode,
            worktreePath,
            branch,
            baseCommit,
          })
          .where(eq(sessions.id, request.params.id))
          .returning();

        // Restart the agent process if it was running or if we want to ensure it starts in the new mode
        const provider = await fastify.providerRegistry.ensureProviderReady(
          updatedSession.selectedProvider,
          {
            force: false,
          },
        );

        if (provider.status === 'ready' || provider.status === 'needs_auth') {
          const launch = provider.getLaunchConfig(
            updatedSession.selectedModel,
            updatedSession.selectedThinkingEffort,
          );
          fastify.sessionManager.restartSession(request.params.id, updatedSession.worktreePath, {
            command: launch.command,
            args: launch.args,
            env: launch.env,
          });
        }

        return updatedSession;
      } catch (err) {
        request.log.error(err, 'Failed to switch session mode');
        throw new AppError(
          err instanceof Error ? err.message : 'Failed to switch session mode',
          500,
        );
      }
    },
  );

  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/sessions/:id/merge',
    {
      schema: {
        params: sessionParamsSchema,
        body: z.object({
          commitMessage: z.string().optional(),
        }),
      },
    },
    async (request) => {
      const { id } = request.params;
      const { commitMessage } = request.body;

      const session = await fastify.db.query.sessions.findFirst({
        where: eq(sessions.id, id),
        with: { project: true },
      });

      if (!session) {
        throw new AppError('Session not found', 404);
      }

      const project = session.project;
      if (!project) {
        throw new AppError('Project not found', 404);
      }

      if (session.mode === 'worktree') {
        if (!project.repoRoot) {
          throw new AppError('Project repo root not set. Cannot merge.', 400);
        }

        // Stop session process
        fastify.sessionManager.stopSession(id);

        try {
          await fastify.worktreeManager.finalize(
            project.repoRoot,
            session.worktreePath,
            session.branch,
            'main', // default to main
            'merge',
            session.taskSlug,
            commitMessage,
          );
        } catch (err) {
          throw new AppError(err instanceof Error ? err.message : 'Merge failed', 500);
        }
      } else {
        // Stop session process
        fastify.sessionManager.stopSession(id);
      }

      // Update session status in DB
      const [updatedSession] = await fastify.db
        .update(sessions)
        .set({
          status: 'merged',
          closedAt: new Date(),
        })
        .where(eq(sessions.id, id))
        .returning();

      return updatedSession;
    }
  );

  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/sessions/:id/discard',
    {
      schema: {
        params: sessionParamsSchema,
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

      const project = session.project;
      if (!project) {
        throw new AppError('Project not found', 404);
      }

      if (session.mode === 'worktree') {
        if (!project.repoRoot) {
          throw new AppError('Project repo root not set. Cannot discard.', 400);
        }

        // Stop session process
        fastify.sessionManager.stopSession(id);

        try {
          await fastify.worktreeManager.finalize(
            project.repoRoot,
            session.worktreePath,
            session.branch,
            'main',
            'discard',
            session.taskSlug,
          );
        } catch (err) {
          throw new AppError(err instanceof Error ? err.message : 'Discard failed', 500);
        }
      } else {
        // Stop session process
        fastify.sessionManager.stopSession(id);
      }

      // Update session status in DB
      const [updatedSession] = await fastify.db
        .update(sessions)
        .set({
          status: 'discarded',
          closedAt: new Date(),
        })
        .where(eq(sessions.id, id))
        .returning();

      return updatedSession;
    }
  );

  done();
};

