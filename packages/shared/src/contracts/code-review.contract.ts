import { z } from 'zod';
import { codeReviewFileSchema } from '../schemas/review-continuity.js';
import {
  codeReviewRunSchema,
  startCodeReviewSchema,
  resolveReviewFindingSchema,
} from '../schemas/code-review.js';
import { emptyBodySchema } from './contract-common.js';
const sessionParams = z.object({ id: z.uuid() });
const runParams = sessionParams.extend({ reviewId: z.uuid() });
const failure = z.object({ message: z.string() });
export const codeReviewContract = {
  getCodeReviewFile: {
    method: 'GET',
    path: '/api/sessions/:id/code-reviews/:reviewId/file',
    pathParams: runParams,
    query: z.object({ path: z.string().min(1).max(1024) }),
    responses: { 200: codeReviewFileSchema },
  },
  listCodeReviews: {
    method: 'GET',
    path: '/api/sessions/:id/code-reviews',
    pathParams: sessionParams,
    query: z.object({ before: z.uuid().optional() }),
    responses: {
      200: z.object({ runs: z.array(codeReviewRunSchema), nextCursor: z.uuid().nullable() }),
    },
    summary: 'List saved AI reviews and their freshness against the current workspace',
  },
  startCodeReview: {
    method: 'POST',
    path: '/api/sessions/:id/code-reviews',
    pathParams: sessionParams,
    body: startCodeReviewSchema,
    responses: { 202: z.object({ id: z.uuid() }), 400: failure, 409: failure },
    summary: 'Start an independent review of captured changes using any ACP provider',
  },
  cancelCodeReview: {
    method: 'POST',
    path: '/api/sessions/:id/code-reviews/:reviewId/cancel',
    pathParams: runParams,
    body: emptyBodySchema,
    responses: { 200: z.object({ success: z.boolean() }) },
  },
  resolveCodeReviewFinding: {
    method: 'PATCH',
    path: '/api/sessions/:id/code-reviews/:reviewId/findings/:findingId',
    pathParams: runParams.extend({ findingId: z.uuid() }),
    body: resolveReviewFindingSchema,
    responses: { 200: z.object({ success: z.boolean() }) },
  },
} as const;
