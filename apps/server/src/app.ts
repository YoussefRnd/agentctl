import Fastify from 'fastify';
import cors from '@fastify/cors';
import secureSession from '@fastify/secure-session';
import authPlugin from './plugins/auth.js';
import worktreePlugin from './plugins/worktree.js';
import sessionManagerPlugin from './plugins/session-manager.js';
import tsRestPlugin from './plugins/ts-rest.js';
import { eventsRoutes } from './routes/events.js';
import { authRoutes } from './routes/auth.js';
import { serializerCompiler, validatorCompiler } from '@fastify/type-provider-zod';
import { db as defaultDb, projects, sessions } from '@agentctl/core/db';
import { WorktreeManager, GitMutex } from '@agentctl/core/git';
import { ProviderRegistry } from '@agentctl/core/providers';
import { SessionManager } from '@agentctl/core/session';
import { McpGateway } from '@agentctl/core/mcp';
import { EventBus } from './utils/event-bus.js';
import { AppError } from './errors/app-error.js';
import type { FastifyError } from 'fastify';
import { parseServerEnv } from '@agentctl/shared';
import { SessionService } from './services/session-service.js';

export interface AppDependencies {
  db?: typeof defaultDb;
  worktreeManager?: WorktreeManager;
  providerRegistry?: ProviderRegistry;
  sessionManager?: SessionManager;
  env?: ReturnType<typeof parseServerEnv>;
  embedded?: boolean;
}

declare module 'fastify' {
  interface FastifyInstance {
    db: typeof defaultDb;
    worktreeManager: WorktreeManager;
    gitMutex: GitMutex;
    providerRegistry: ProviderRegistry;
    sessionManager: SessionManager;
    sessionService: SessionService;
    eventBus: EventBus;
    config: ReturnType<typeof parseServerEnv>;
    mcpGateway: McpGateway;
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
  const providerRegistry = deps.providerRegistry ?? new ProviderRegistry(db, fastify.log);
  const config = deps.env ?? parseServerEnv(process.env);
  const eventBus = new EventBus();

  const mcpGateway = new McpGateway(db, fastify.log);

  const sessionManager =
    deps.sessionManager ??
    new SessionManager(
      db,
      worktreeManager,
      providerRegistry,
      eventBus,
      fastify.log,
      undefined,
      mcpGateway,
    );

  const sessionService = new SessionService(
    db,
    sessionManager,
    worktreeManager,
    providerRegistry,
    fastify.log,
  );

  fastify.decorate('db', db);
  fastify.decorate('gitMutex', gitMutex);
  fastify.decorate('worktreeManager', worktreeManager);
  fastify.decorate('providerRegistry', providerRegistry);
  fastify.decorate('sessionManager', sessionManager);
  fastify.decorate('sessionService', sessionService);
  fastify.decorate('eventBus', eventBus);
  fastify.decorate('config', config);
  fastify.decorate('mcpGateway', mcpGateway);

  // Sync provider metadata in the background on startup (lazy probing on session demand)
  void providerRegistry.sync().catch((err: unknown) => {
    fastify.log.error(err, 'Failed to sync provider registry on startup');
  });

  // Prune orphaned worktrees on startup
  if (typeof sessionManager.syncOrphans === 'function') {
    void sessionManager.syncOrphans().catch((err: unknown) => {
      fastify.log.error(err, 'Failed to sync orphaned worktrees on startup');
    });
  }

  fastify.addHook('onClose', async () => {
    await fastify.sessionManager.stopAll();
    await mcpGateway.stop();
  });

  fastify.ready(async () => {
    try {
      const activeProjects = await db.select().from(projects);
      const activeSessions = await db.select().from(sessions);
      const activeSessionIds = activeSessions.map((s) => s.id);

      for (const project of activeProjects) {
        if (project.repoRoot) {
          await worktreeManager.sync(project.repoRoot, activeSessionIds);
        }
      }
    } catch (err) {
      fastify.log.error(err, 'Failed to sync orphaned worktrees on startup');
    }

    try {
      await mcpGateway.start();
    } catch (err) {
      fastify.log.error(err, 'Failed to start MCP Gateway');
    }
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

  const isProd = process.env.NODE_ENV === 'production';
  const allowedOrigins = config.CORS_ALLOWED_ORIGINS
    ? config.CORS_ALLOWED_ORIGINS.split(',').map((o) => o.trim())
    : ['http://localhost:5173', 'http://localhost:5174'];

  await fastify.register(cors, {
    origin: isProd
      ? (origin, cb) => {
          if (!origin) {
            cb(null, true);
            return;
          }
          if (allowedOrigins.includes(origin)) {
            cb(null, true);
            return;
          }
          cb(new Error('Not allowed by CORS'), false);
        }
      : true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Origin',
      'Accept',
      'Last-Event-Id',
      'Last-Event-ID',
    ],
  });

  // Register Secure Session
  await fastify.register(secureSession, {
    secret: config.AGENTCTL_SESSION_KEY,
    salt: config.AGENTCTL_SESSION_SALT,
    expiry: 24 * 60 * 60,
    cookie: {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production' && !deps.embedded,
      maxAge: 24 * 60 * 60,
      sameSite: 'lax',
    },
  });

  // Register Auth Plugin first
  await fastify.register(authPlugin);

  // Register other plugins
  await fastify.register(worktreePlugin);
  await fastify.register(sessionManagerPlugin);
  await fastify.register(tsRestPlugin);

  // Register routes
  await fastify.register(authRoutes, { prefix: '/api' });
  await fastify.register(eventsRoutes, { prefix: '/api' });

  // Basic route to verify server is up
  fastify.get('/health', () => {
    return { status: 'ok' };
  });

  return fastify;
}
