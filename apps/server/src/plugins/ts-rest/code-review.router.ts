import type { FastifyInstance } from 'fastify';
import type { RouterImplementation } from '@ts-rest/fastify';
import { sessionsContract } from '@agentctl/shared';
import { AppError } from '../../errors/app-error.js';

type ReviewContract = Pick<
  typeof sessionsContract,
  | 'prepareReviewFindingHandoff'
  | 'updateWalkthroughProgress'
  | 'prepareWalkthroughQuestion'
  | 'getCodeReviewFile'
  | 'listCodeReviews'
  | 'startCodeReview'
  | 'cancelCodeReview'
  | 'resolveCodeReviewFinding'
  | 'listReviewChecks'
  | 'getReviewCheck'
  | 'runReviewCheck'
  | 'cancelReviewCheck'
  | 'confirmReviewFindingEvidence'
>;
export function createCodeReviewRouter(app: FastifyInstance): RouterImplementation<ReviewContract> {
  return {
    updateWalkthroughProgress: async ({ params, body }) => {
      try {
        return {
          status: 200,
          body: app.services.codeReview.progress(params.id, params.reviewId, body),
        };
      } catch (error) {
        if (error instanceof AppError && error.statusCode === 404) throw error;
        return {
          status: 400,
          body: { message: error instanceof Error ? error.message : String(error) },
        };
      }
    },
    prepareWalkthroughQuestion: async ({ params }) => {
      try {
        return {
          status: 200,
          body: await app.services.codeReview.walkthroughQuestion(
            params.id,
            params.reviewId,
            params.position,
          ),
        };
      } catch (error) {
        if (error instanceof AppError && error.statusCode === 404) throw error;
        return {
          status: 400,
          body: { message: error instanceof Error ? error.message : String(error) },
        };
      }
    },
    prepareReviewFindingHandoff: async ({ params, body }) => {
      try {
        return {
          status: 200,
          body: await app.services.codeReview.handoff(
            params.id,
            params.reviewId,
            params.findingId,
            body,
          ),
        };
      } catch (error) {
        if (error instanceof AppError && error.statusCode === 404) throw error;
        return {
          status: 400,
          body: { message: error instanceof Error ? error.message : String(error) },
        };
      }
    },
    getCodeReviewFile: async ({ params, query }) => ({
      status: 200,
      body: await app.services.codeReview.file(params.id, params.reviewId, query.path),
    }),
    listReviewChecks: async ({ params, query }) => ({
      status: 200,
      body: app.services.reviewVerification.list(params.id, params.reviewId, query.before),
    }),
    getReviewCheck: async ({ params }) => ({
      status: 200,
      body: app.services.reviewVerification.get(params.id, params.reviewId, params.checkId),
    }),
    runReviewCheck: async ({ params, body }) => {
      try {
        return {
          status: 202,
          body: await app.services.reviewVerification.start(params.id, params.reviewId, body),
        };
      } catch (error) {
        if (error instanceof AppError && error.statusCode === 404) throw error;
        return {
          status: error instanceof AppError && error.statusCode === 409 ? 409 : 400,
          body: { message: error instanceof Error ? error.message : String(error) },
        };
      }
    },
    cancelReviewCheck: async ({ params }) => ({
      status: 200,
      body: app.services.reviewVerification.cancel(params.id, params.reviewId, params.checkId),
    }),
    confirmReviewFindingEvidence: async ({ params, body }) => {
      try {
        return {
          status: 200,
          body: app.services.reviewVerification.confirm(
            params.id,
            params.reviewId,
            params.findingId,
            body,
          ),
        };
      } catch (error) {
        if (error instanceof AppError && error.statusCode === 404) throw error;
        return {
          status: error instanceof AppError && error.statusCode === 409 ? 409 : 400,
          body: { message: error instanceof Error ? error.message : String(error) },
        };
      }
    },
    listCodeReviews: async ({ params, query }) => ({
      status: 200,
      body: await app.services.codeReview.list(params.id, query.before),
    }),
    startCodeReview: async ({ params, body }) => {
      try {
        return { status: 202, body: await app.services.codeReview.start(params.id, body) };
      } catch (error) {
        if (error instanceof AppError && error.statusCode === 404) throw error;
        return {
          status: error instanceof AppError && error.statusCode === 409 ? 409 : 400,
          body: { message: error instanceof Error ? error.message : String(error) },
        };
      }
    },
    cancelCodeReview: async ({ params }) => ({
      status: 200,
      body: app.services.codeReview.cancel(params.id, params.reviewId),
    }),
    resolveCodeReviewFinding: async ({ params, body }) => ({
      status: 200,
      body: app.services.codeReview.resolve(params.id, params.reviewId, params.findingId, body),
    }),
  };
}
