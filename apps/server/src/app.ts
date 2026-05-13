import Fastify from 'fastify';
import authPlugin from './plugins/auth.js';
import worktreePlugin from './plugins/worktree.js';
import sessionManagerPlugin from './plugins/session-manager.js';
import websocketPlugin from './plugins/websocket.js';
import { eventsRoutes } from './routes/events.js';
import projectsRoutes from './routes/projects.js';
import { sessionsRoutes } from './routes/sessions.js';
import { serializerCompiler, validatorCompiler } from '@fastify/type-provider-zod';

export async function buildApp() {
	const fastify = Fastify({
		logger: true,
	});

	fastify.setValidatorCompiler(validatorCompiler);
	fastify.setSerializerCompiler(serializerCompiler);

	// Register Auth Plugin first
	await fastify.register(authPlugin);

	// Register other plugins
	await fastify.register(worktreePlugin);
	await fastify.register(sessionManagerPlugin);
	await fastify.register(websocketPlugin);

	// Register routes
	await fastify.register(projectsRoutes, { prefix: '/api' });
	await fastify.register(sessionsRoutes, { prefix: '/api' });
	await fastify.register(eventsRoutes);

	// Basic route to verify server is up
	fastify.get('/health', () => {
		return { status: 'ok' };
	});

	return fastify;
}
