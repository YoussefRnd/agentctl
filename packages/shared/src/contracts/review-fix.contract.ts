import { z } from 'zod';
import {
  createReviewFixSchema,
  reviewFixSchema,
  verifyReviewFixSchema,
} from '../schemas/review-fix.js';
import { emptyBodySchema } from './contract-common.js';
const finding = z.object({ id: z.uuid(), reviewId: z.uuid(), findingId: z.uuid() });
const attempt = finding.extend({ attemptId: z.uuid() });
const failure = z.object({ message: z.string() });
export const reviewFixContract = {
  listReviewFixes: {
    method: 'GET',
    path: '/api/sessions/:id/code-reviews/:reviewId/findings/:findingId/fixes',
    pathParams: finding,
    query: z.object({ before: z.uuid().optional() }),
    responses: {
      200: z.object({ attempts: z.array(reviewFixSchema), nextCursor: z.uuid().nullable() }),
    },
  },
  createReviewFix: {
    method: 'POST',
    path: '/api/sessions/:id/code-reviews/:reviewId/findings/:findingId/fixes',
    pathParams: finding,
    body: createReviewFixSchema,
    responses: { 200: z.object({ id: z.uuid(), prompt: z.string() }), 400: failure, 409: failure },
  },
  verifyReviewFix: {
    method: 'POST',
    path: '/api/sessions/:id/code-reviews/:reviewId/findings/:findingId/fixes/:attemptId/check',
    pathParams: attempt,
    body: verifyReviewFixSchema,
    responses: { 202: z.object({ id: z.uuid() }), 400: failure, 409: failure },
  },
  reviewReviewFix: {
    method: 'POST',
    path: '/api/sessions/:id/code-reviews/:reviewId/findings/:findingId/fixes/:attemptId/review',
    pathParams: attempt,
    body: emptyBodySchema,
    responses: { 202: z.object({ id: z.uuid() }), 400: failure, 409: failure },
  },
} as const;
