import { z } from 'zod';
import { repositoryCaptureSchema } from './repository.js';
import { reviewCheckSummarySchema, runReviewCheckSchema } from './review-verification.js';
import { reviewFreshnessSchema } from './review.js';
export const createReviewFixSchema = z.object({
  id: z.uuid(),
  beforeCheckId: z.uuid().nullable().default(null),
  notes: z.string().trim().max(2000).default(''),
  expectedCapture: repositoryCaptureSchema,
});
export const reviewFixSchema = z.object({
  id: z.uuid(),
  reviewId: z.uuid(),
  findingId: z.uuid(),
  requestRevision: z.string(),
  beforeCheckId: z.uuid().nullable(),
  createdAt: z.number(),
  requestEventId: z.number().nullable(),
  before: reviewCheckSummarySchema.nullable(),
  after: reviewCheckSummarySchema.nullable(),
  runs: z.array(z.object({ kind: z.enum(['check', 'review']), id: z.uuid(), reviewId: z.uuid() })),
  followup: z
    .object({
      id: z.uuid(),
      status: z.string(),
      providerId: z.string(),
      modelId: z.string(),
      summary: z.string(),
      error: z.string().nullable(),
      fromRevision: z.string(),
      toRevision: z.string(),
      findings: z.number().int(),
    })
    .nullable(),
  outcome: z.enum([
    'not_checked',
    'checking',
    'reviewing',
    'suggested_fixed',
    'still_failing',
    'needs_investigation',
  ]),
  reason: z.string(),
  freshness: reviewFreshnessSchema,
});
export const verifyReviewFixSchema = runReviewCheckSchema;
export type CreateReviewFix = z.infer<typeof createReviewFixSchema>;
export type ReviewFix = z.infer<typeof reviewFixSchema>;
