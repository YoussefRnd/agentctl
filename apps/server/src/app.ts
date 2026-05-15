import Fastify from 'fastify';
import cors from '@fastify/cors';
import secureSession from '@fastify/secure-session';
import authPlugin from './plugins/auth.js';
import worktreePlugin from './plugins/worktree.js';
import sessionManagerPlugin from './plugins/session-manager.js';
import websocketPlugin from './plugins/websocket.js';
import { sessionReviewRoutes } from './routes/session-review.js';
import { eventsRoutes } from './routes/events.js';
import { projectsRoutes } from './routes/projects.js';
import { sessionsRoutes } from './routes/sessions.js';
import { driversRoutes } from './routes/drivers.js';
import { authRoutes } from './routes/auth.js';
import { serializerCompiler, validatorCompiler } from '@fastify/type-provider-zod';
import { db as defaultDb, WorktreeManager, GitMutex, DriverRegistry } from '@agentctl/core';

import { parseEnv } from '@agentctl/shared';

export interface AppDependencies {
	db?: typeof defaultDb;
	worktreeManager?: WorktreeManager;
	driverRegistry?: DriverRegistry;
	env?: ReturnType<typeof parseEnv>;
}

declare module 'fastify' {
	interface FastifyInstance {
		db: typeof defaultDb;
		worktreeManager: WorktreeManager;
		gitMutex: GitMutex;
		driverRegistry: DriverRegistry;
		config: ReturnType<typeof parseEnv>;
	}
}

declare module '@fastify/secure-session' {
	interface SessionData {
		authenticated: boolean;
	}
}

export async function buildApp(deps: AppDependencies = {}) {
	const fastify = Fastify({
		logger: true,
	});

	const db = deps.db ?? defaultDb;
	const gitMutex = new GitMutex();
	const worktreeManager = deps.worktreeManager ?? new WorktreeManager(gitMutex);
	const driverRegistry = deps.driverRegistry ?? new DriverRegistry();
	const config = deps.env ?? parseEnv(process.env);

	fastify.decorate('db', db);
	fastify.decorate('gitMutex', gitMutex);
	fastify.decorate('worktreeManager', worktreeManager);
	fastify.decorate('driverRegistry', driverRegistry);
	fastify.decorate('config', config);

	fastify.setValidatorCompiler(validatorCompiler);
	fastify.setSerializerCompiler(serializerCompiler);

	await fastify.register(cors, {
		origin: ['http://localhost:5173'],
		credentials: true,
	});

	// Register Secure Session
 	await fastify.register(secureSession, {
		secret: config.AGENTCTL_SESSION_KEY,
		salt: config.AGENTCTL_SESSION_SALT,
		expiry: 24 * 60 * 60,
		cookie: {
			path: '/',
			httpOnly: true,
			secure: process.env.NODE_ENV === 'production',
			maxAge: 24 * 60 * 60,
			sameSite: 'lax',
		},
	});

	// Register Auth Plugin first
	await fastify.register(authPlugin);

	// Register other plugins
	await fastify.register(worktreePlugin);
	await fastify.register(sessionManagerPlugin);
	await fastify.register(websocketPlugin);

	// Register routes
	await fastify.register(authRoutes, { prefix: '/api' });
	await fastify.register(projectsRoutes, { prefix: '/api' });
	await fastify.register(sessionsRoutes, { prefix: '/api' });
	await fastify.register(sessionReviewRoutes, { prefix: '/api' });
	await fastify.register(driversRoutes, { prefix: '/api' });
	await fastify.register(eventsRoutes);

	// Basic route to verify server is up
	fastify.get('/health', () => {
		return { status: 'ok' };
	});

	return fastify;
}
