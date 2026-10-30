import { z } from 'zod';
import {
  reviewCheckSummarySchema,
  reviewCheckResultSchema,
  runReviewCheckSchema,
  confirmFindingEvidenceSchema,
} from '../schemas/review-verification.js';
import { emptyBodySchema } from './contract-common.js';
const run = z.object({ id: z.uuid(), reviewId: z.uuid() });
const check = run.extend({ checkId: z.uuid() });
const failure = z.object({ message: z.string() });
export const reviewVerificationContract = {
  listReviewChecks: {
    method: 'GET',
    path: '/api/sessions/:id/code-reviews/:reviewId/checks',
    pathParams: run,
    query: z.object({ before: z.uuid().optional() }),
    responses: {
      200: z.object({ checks: z.array(reviewCheckSummarySchema), nextCursor: z.uuid().nullable() }),
    },
  },
  getReviewCheck: {
    method: 'GET',
    path: '/api/sessions/:id/code-reviews/:reviewId/checks/:checkId',
    pathParams: check,
    responses: { 200: reviewCheckResultSchema },
  },
  runReviewCheck: {
    method: 'POST',
    path: '/api/sessions/:id/code-reviews/:reviewId/checks',
    pathParams: run,
    body: runReviewCheckSchema,
    responses: { 202: z.object({ id: z.uuid() }), 400: failure, 409: failure },
  },
  cancelReviewCheck: {
    method: 'POST',
    path: '/api/sessions/:id/code-reviews/:reviewId/checks/:checkId/cancel',
    pathParams: check,
    body: emptyBodySchema,
    responses: { 200: z.object({ success: z.boolean() }) },
  },
  confirmReviewFindingEvidence: {
    method: 'POST',
    path: '/api/sessions/:id/code-reviews/:reviewId/findings/:findingId/evidence',
    pathParams: run.extend({ findingId: z.uuid() }),
    body: confirmFindingEvidenceSchema,
    responses: { 200: z.object({ success: z.boolean() }), 400: failure, 409: failure },
  },
} as const;
