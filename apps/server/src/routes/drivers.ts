import type { FastifyPluginCallbackZod } from '@fastify/type-provider-zod';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import { z } from 'zod';

export const driversRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
	fastify.withTypeProvider<ZodTypeProvider>().get('/drivers', async () => {
		return await fastify.driverRegistry.discover();
	});

	fastify.withTypeProvider<ZodTypeProvider>().post(
		'/drivers/:id/login',
		{
			schema: {
				params: z.object({ id: z.string() }),
				body: z.object({
					methodId: z.string(),
					params: z.record(z.string(), z.any()).optional(),
				}),
			},
		},
		async (request) => {
			const { id } = request.params;
			const { methodId, params } = request.body;
			await fastify.driverRegistry.login(id, methodId, params);
			return { success: true };
		},
	);
	fastify.withTypeProvider<ZodTypeProvider>().post(
		'/drivers/:id/activate',
		{
			schema: {
				params: z.object({ id: z.string() }),
			},
		},
		async (request) => {
			const { id } = request.params;
			return await fastify.driverRegistry.activate(id);
		},
	);

	fastify.withTypeProvider<ZodTypeProvider>().post(
		'/drivers/:id/refresh',
		{
			schema: {
				params: z.object({ id: z.string() }),
			},
		},
		async (request) => {
			const { id } = request.params;
			return await fastify.driverRegistry.refreshDriver(id);
		},
	);

	fastify.withTypeProvider<ZodTypeProvider>().post(
		'/drivers/:id/toggle',
		{
			schema: {
				params: z.object({ id: z.string() }),
				body: z.object({ enabled: z.boolean() }),
			},
		},
		async (request) => {
			const { id } = request.params;
			const { enabled } = request.body;
			return await fastify.driverRegistry.setDriverEnabled(id, enabled);
		},
	);

	fastify.withTypeProvider<ZodTypeProvider>().post(
		'/drivers/:id/config',
		{
			schema: {
				params: z.object({ id: z.string() }),
				body: z.object({
					customEnv: z.record(z.string(), z.string()),
				}),
			},
		},
		async (request) => {
			const { id } = request.params;
			const { customEnv } = request.body;
			return await fastify.driverRegistry.setDriverConfig(id, customEnv);
		},
	);

	fastify.withTypeProvider<ZodTypeProvider>().post('/drivers/sync', async () => {
		await fastify.driverRegistry.sync();
		return await fastify.driverRegistry.discover();
	});
	done();
};
