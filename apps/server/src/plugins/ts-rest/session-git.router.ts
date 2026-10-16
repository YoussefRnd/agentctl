import type { FastifyInstance } from 'fastify';
import type { RouterImplementation } from '@ts-rest/fastify';
import { sessionGitContract } from '@agentctl/shared';
import { AppError } from '../../errors/app-error.js';
import { publishWorkspaceChange } from '../../services/session-state-events.js';

export function createSessionGitRouter(
  fastify: FastifyInstance,
): RouterImplementation<typeof sessionGitContract> {
  return {
    getSessionBranches: async ({ params }) => {
      const { id } = params;
      const result = await fastify.sessionService.listBranches(id);
      return {
        status: 200 as const,
        body: result,
      };
    },
    getSessionMergePreview: async ({ params, query }) => {
      try {
        return { status: 200, body: await fastify.services.git.preview(params.id, query) };
      } catch (error) {
        if (error instanceof AppError && error.statusCode === 404) throw error;
        return {
          status: 400,
          body: { message: error instanceof Error ? error.message : String(error) },
        };
      }
    },
    getSessionReview: async ({ params, query }) => ({
      status: 200,
      body: await fastify.services.git.review(params.id, query),
    }),
    stageFile: async ({ params, body }) => {
      const { id } = params;
      const { filePath } = body;
      await fastify.services.git.stageFile(id, filePath);
      return { status: 200 as const, body: { success: true } };
    },
    revertFile: async ({ params, body }) => {
      const { id } = params;
      const { filePath } = body;
      await fastify.services.git.revertFile(id, filePath);
      return { status: 200 as const, body: { success: true } };
    },
    unstageFile: async ({ params, body }) => {
      const { id } = params;
      const { filePath } = body;
      await fastify.services.git.unstageFile(id, filePath);
      return { status: 200 as const, body: { success: true } };
    },
    stageAllFiles: async ({ params }) => {
      const { id } = params;
      await fastify.services.git.stageAll(id);
      return { status: 200 as const, body: { success: true } };
    },
    unstageAllFiles: async ({ params }) => {
      const { id } = params;
      await fastify.services.git.unstageAll(id);
      return { status: 200 as const, body: { success: true } };
    },
    commitChanges: async ({ params, body }) => {
      const { id } = params;
      const { message } = body;
      try {
        await fastify.services.git.commit(id, message, body.includeUnstaged);
        return { status: 200 as const, body: { success: true } };
      } catch (err) {
        return {
          status: 400 as const,
          body: { message: err instanceof Error ? err.message : String(err) },
        };
      }
    },
    pushChanges: async ({ params }) => {
      const { id } = params;
      try {
        const result = await fastify.services.git.push(id);
        return { status: 200 as const, body: result };
      } catch (err) {
        return {
          status: 400 as const,
          body: { message: err instanceof Error ? err.message : String(err) },
        };
      }
    },
    pullChanges: async ({ params }) => {
      const { id } = params;
      try {
        const result = await fastify.services.git.pull(id);
        return { status: 200 as const, body: result };
      } catch (err) {
        return {
          status: 400 as const,
          body: { message: err instanceof Error ? err.message : String(err) },
        };
      }
    },
    fetchChanges: async ({ params }) => {
      try {
        const result = await fastify.services.git.fetch(params.id);
        return { status: 200 as const, body: result };
      } catch (err) {
        return {
          status: 400 as const,
          body: { message: err instanceof Error ? err.message : String(err) },
        };
      }
    },
    createSessionBranch: async ({ params, body }) => {
      try {
        await fastify.sessionService.checkoutBranch(params.id, body.name, true);
        publishWorkspaceChange(fastify.eventBus, params.id);
        return { status: 200 as const, body: { success: true } };
      } catch (err) {
        return {
          status: 400 as const,
          body: { message: err instanceof Error ? err.message : String(err) },
        };
      }
    },
    getGitStatus: async ({ params }) => ({
      status: 200,
      body: await fastify.services.git.status(params.id),
    }),
    generateGitDraft: async ({ params, body }) => {
      try {
        return { status: 200, body: await fastify.services.git.generateDraft(params.id, body) };
      } catch (error) {
        return {
          status: 400,
          body: { message: error instanceof Error ? error.message : String(error) },
        };
      }
    },
    createPullRequest: async ({ params, body }) => {
      const { id } = params;

      try {
        const result = await fastify.services.git.createPullRequest(id, body);
        return { status: 200 as const, body: result };
      } catch (err) {
        return {
          status: 400 as const,
          body: { message: err instanceof Error ? err.message : String(err) },
        };
      }
    },
    mergeSessionBranch: async ({ params, body }) => {
      const { id } = params;
      const { branch } = body;
      await fastify.sessionService.mergeSessionBranch(id, branch);
      publishWorkspaceChange(fastify.eventBus, id);
      return {
        status: 200 as const,
        body: { success: true },
      };
    },
    checkMergeBranch: async ({ params, query }) => {
      const { id } = params;
      const { branch } = query;
      const result = await fastify.sessionService.checkMergeBranch(id, branch);
      return {
        status: 200 as const,
        body: result,
      };
    },
  };
}
