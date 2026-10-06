import type { FastifyInstance } from 'fastify';
import type { RouterImplementation } from '@ts-rest/fastify';
import { eq, and } from 'drizzle-orm';
import path from 'node:path';
import { projects, nativeSessionImports } from '@agentctl/core/db';
import { AppError } from '../../errors/app-error.js';
import { providersContract } from '@agentctl/shared';

export function createProvidersRouter(
  fastify: FastifyInstance,
): RouterImplementation<typeof providersContract> {
  const providerChanged = <T>(body: T) => {
    fastify.eventBus.publishState({ topics: ['providers'] });
    return { status: 200 as const, body };
  };
  return {
    respondAuthInteraction: async ({ params, body }) => {
      const success = fastify.providerRegistry
        .getAuthCoordinator()
        .respondAuthInteraction(params.id, body.interactionId, body.accepted);
      if (!success) throw new AppError('Authentication request expired or already answered', 409);
      return { status: 200 as const, body: { success } };
    },
    createProfile: async ({ params, body }) => ({
      status: 200 as const,
      body: await fastify.providerRegistry.createProfile(params.id, body.name),
    }),
    listNativeSessions: async ({ params, query }) => {
      const project = await fastify.db.query.projects.findFirst({
        where: eq(projects.id, query.projectId),
      });
      if (!project) throw new AppError('Project not found', 404);
      const page = await fastify.providerRegistry.listNativeSessions(
        params.id,
        project.path,
        query.cursor,
      );
      const imports = await fastify.db
        .select()
        .from(nativeSessionImports)
        .where(
          and(
            eq(nativeSessionImports.projectId, project.id),
            eq(nativeSessionImports.providerId, params.id),
            eq(nativeSessionImports.completed, true),
          ),
        );
      const sessions = page.sessions.flatMap((value) => {
        if (!value || typeof value !== 'object') return [];
        const row = value as Record<string, unknown>;
        if (
          typeof row.sessionId !== 'string' ||
          typeof row.cwd !== 'string' ||
          path.resolve(row.cwd) !== path.resolve(project.path)
        )
          return [];
        return [
          {
            sessionId: row.sessionId,
            cwd: row.cwd,
            title: typeof row.title === 'string' ? row.title : undefined,
            updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : undefined,
            importedSessionId: imports.find((item) => item.nativeSessionId === row.sessionId)
              ?.sessionId,
          },
        ];
      });
      return { status: 200 as const, body: { sessions, nextCursor: page.nextCursor } };
    },
    getProviders: async () => {
      const providers = await fastify.providerRegistry.discover();
      return {
        status: 200 as const,
        body: providers,
      };
    },
    getRegistry: async () => {
      const providers = await fastify.providerRegistry.catalog();
      return {
        status: 200 as const,
        body: providers,
      };
    },
    installProvider: async ({ params }) => {
      const { id } = params;
      const result = await fastify.providerRegistry.install(id);
      return providerChanged(result);
    },
    cancelInstallProvider: async ({ params }) => {
      fastify.providerRegistry.cancelInstall(params.id);
      return providerChanged({ success: true });
    },
    removeProvider: async ({ params }) => {
      const { id } = params;
      const result = await fastify.providerRegistry.remove(id);
      return providerChanged(result);
    },
    loginProvider: async ({ params, body }) => {
      const { id } = params;
      const { methodId } = body;
      await fastify.providerRegistry.login(id, methodId);
      return providerChanged({ success: true });
    },
    cancelLoginProvider: async ({ params }) => {
      const { id } = params;
      fastify.providerRegistry.cancelLogin(id);
      return providerChanged({ success: true });
    },
    verifyProvider: async ({ params }) => {
      const { id } = params;
      const result = await fastify.providerRegistry.verify(id);
      return providerChanged(result);
    },
    logoutProvider: async ({ params }) => {
      const { id } = params;
      await fastify.providerRegistry.logout(id);
      return providerChanged({ success: true });
    },
    activateProvider: async ({ params }) => {
      const { id } = params;
      const result = await fastify.providerRegistry.activate(id);
      return providerChanged(result);
    },
    refreshProvider: async ({ params }) => {
      const { id } = params;
      const result = await fastify.providerRegistry.refreshProvider(id);
      return providerChanged(result);
    },
    setProviderConfig: async ({ params, body }) => {
      const result = await fastify.providerRegistry.setProviderConfig(params.id, body);
      return providerChanged(result);
    },
    syncProviders: async () => {
      await fastify.providerRegistry.sync();
      const providers = await fastify.providerRegistry.discover();
      return {
        status: 200 as const,
        body: providers,
      };
    },
  };
}
