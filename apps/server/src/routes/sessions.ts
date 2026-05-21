import { z } from 'zod';
import { sessions } from '@agentctl/core';
import { eq } from 'drizzle-orm';
import type { FastifyPluginCallbackZod } from '@fastify/type-provider-zod';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import { AppError } from '../errors/app-error.js';

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
					driverId: request.body.agent,
					taskSlug: request.body.taskSlug,
				});

				// Return the created session record from the database
				const sessionRecord = await fastify.db.query.sessions.findFirst({
					where: eq(sessions.id, session.sessionId),
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

			const driver = await fastify.driverRegistry.ensureDriverReady(updatedSession.selectedDriver, {
				force: false,
			});

			if (driver.status === 'ready' || driver.status === 'needs_auth') {
				const launch = driver.getLaunchConfig(
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
