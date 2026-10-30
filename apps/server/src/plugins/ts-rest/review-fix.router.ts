import type { FastifyInstance } from 'fastify';
import type { RouterImplementation } from '@ts-rest/fastify';
import { sessionsContract } from '@agentctl/shared';
import { AppError } from '../../errors/app-error.js';
function failure(error: unknown): { status: 400 | 409; body: { message: string } } {
  if (error instanceof AppError && error.statusCode === 404) throw error;
  return {
    status: error instanceof AppError && error.statusCode === 409 ? 409 : 400,
    body: { message: error instanceof Error ? error.message : String(error) },
  };
}
export function createReviewFixRouter(
  app: FastifyInstance,
): RouterImplementation<
  Pick<
    typeof sessionsContract,
    'listReviewFixes' | 'createReviewFix' | 'verifyReviewFix' | 'reviewReviewFix'
  >
> {
  return {
    listReviewFixes: async ({ params, query }) => ({
      status: 200,
      body: await app.services.reviewFix.list(
        params.id,
        params.reviewId,
        params.findingId,
        query.before,
      ),
    }),
    createReviewFix: async ({ params, body }) => {
      try {
        return {
          status: 200,
          body: await app.services.reviewFix.create(
            params.id,
            params.reviewId,
            params.findingId,
            body,
          ),
        };
      } catch (error) {
        return failure(error);
      }
    },
    verifyReviewFix: async ({ params, body }) => {
      try {
        return {
          status: 202,
          body: await app.services.reviewFix.verify(
            params.id,
            params.reviewId,
            params.findingId,
            params.attemptId,
            body,
          ),
        };
      } catch (error) {
        return failure(error);
      }
    },
    reviewReviewFix: async ({ params }) => {
      try {
        return {
          status: 202,
          body: await app.services.reviewFix.review(
            params.id,
            params.reviewId,
            params.findingId,
            params.attemptId,
          ),
        };
      } catch (error) {
        return failure(error);
      }
    },
  };
}
