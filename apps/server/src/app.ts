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
import { fsRoutes } from './routes/fs.js';
import { authRoutes } from './routes/auth.js';
import { serializerCompiler, validatorCompiler } from '@fastify/type-provider-zod';
import { db as defaultDb, WorktreeManager, GitMutex, DriverRegistry } from '@agentctl/core';
import { AppError } from './errors/app-error.js';
import type { FastifyError } from 'fastify';
import { parseServerEnv } from '@agentctl/shared';

export interface AppDependencies {
  db?: typeof defaultDb;
  worktreeManager?: WorktreeManager;
  driverRegistry?: DriverRegistry;
  env?: ReturnType<typeof parseServerEnv>;
}

declare module 'fastify' {
  interface FastifyInstance {
    db: typeof defaultDb;
    worktreeManager: WorktreeManager;
    gitMutex: GitMutex;
    driverRegistry: DriverRegistry;
    config: ReturnType<typeof parseServerEnv>;
  }
}

declare module '@fastify/secure-session' {
  interface SessionData {
    authenticated: boolean;
  }
}

export async function buildApp(deps: AppDependencies = {}) {
  const fastify = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      transport:
        process.env.NODE_ENV !== 'production'
          ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
          : undefined,
    },
  });

  const db = deps.db ?? defaultDb;
  const gitMutex = new GitMutex();
  const worktreeManager = deps.worktreeManager ?? new WorktreeManager(gitMutex);
  const driverRegistry = deps.driverRegistry ?? new DriverRegistry(db, fastify.log);
  const config = deps.env ?? parseServerEnv(process.env);

  fastify.decorate('db', db);
  fastify.decorate('gitMutex', gitMutex);
  fastify.decorate('worktreeManager', worktreeManager);
  fastify.decorate('driverRegistry', driverRegistry);
  fastify.decorate('config', config);

  // Sync drivers in the background on startup
  void driverRegistry.sync().catch((err: unknown) => {
    fastify.log.error(err, 'Failed to sync driver registry on startup');
  });

  // Global error handler — keeps all error serialization in one place.
  fastify.setErrorHandler((error: FastifyError, _request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({ error: error.message });
    }
    // Zod / validation errors carry a statusCode < 500 set by the type provider
    if (error.statusCode && error.statusCode < 500) {
      return reply.code(error.statusCode).send({ error: error.message });
    }
    fastify.log.error(error, 'Unhandled server error');
    return reply.code(500).send({ error: 'Internal server error' });
  });

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
  await fastify.register(fsRoutes, { prefix: '/api' });
  await fastify.register(eventsRoutes, { prefix: '/api' });

  // Basic route to verify server is up
  fastify.get('/health', () => {
    return { status: 'ok' };
  });

  return fastify;
}
