import type { FastifyInstance } from 'fastify';
import type { RouterImplementation } from '@ts-rest/fastify';
import { RepositoryError } from '@agentctl/core/repository';
import { repositoryContract } from '@agentctl/shared';
import { AppError } from '../../errors/app-error.js';

export function createSessionRepositoryRouter(
  fastify: FastifyInstance,
): RouterImplementation<typeof repositoryContract> {
  return {
    getSessionRepository: async ({ params }) => ({
      status: 200 as const,
      body: await fastify.services.repository.getInfo(params.id),
    }),
    getRepositoryReview: async ({ params, query }) => {
      try {
        const review =
          query.fromRevision && query.toRevision && query.filePath
            ? await fastify.services.repository.getFileDiff(
                params.id,
                query.fromRevision,
                query.toRevision,
                query.filePath,
              )
            : await fastify.services.repository.getReview(params.id, {
                includeDiffs: query.includeDiffs !== 'false',
                filePath: query.filePath,
                scope: query.scope,
              });
        return { status: 200 as const, body: review };
      } catch (error) {
        if (error instanceof RepositoryError)
          throw new AppError(error.message, error.code === 'unsupported' ? 409 : 400);
        throw error;
      }
    },
  };
}
