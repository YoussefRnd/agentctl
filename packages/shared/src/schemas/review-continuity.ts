import { z } from 'zod';
import { findingVerificationSchema } from './review-verification.js';
import { reviewFileSchema } from './review.js';

export const reviewDecisionSchema = z.object({
  reviewId: z.uuid(),
  findingId: z.uuid(),
  status: z.enum(['fixed', 'dismissed']),
  resolution: z.string().nullable(),
});
export const reviewHistoricalEvidenceSchema = z.object({
  reviewId: z.uuid(),
  findingId: z.uuid(),
  verification: findingVerificationSchema,
});
export const reviewFindingContinuitySchema = z.object({
  reviewId: z.uuid(),
  findingId: z.uuid(),
  status: z.enum(['open', 'fixed', 'dismissed']),
  resolution: z.string().nullable(),
  verification: findingVerificationSchema,
  comparison: z.enum(['same', 'changed', 'unknown']),
  match: z.enum(['fingerprint', 'reviewer']),
  lastDecision: reviewDecisionSchema.nullable(),
  lastEvidence: reviewHistoricalEvidenceSchema.nullable().default(null),
});
export const reviewContinuityReportSchema = z.object({
  provided: z.number().int(),
  omitted: z.number().int(),
  historyLimited: z.boolean(),
  findingIds: z.array(z.uuid()),
});
export const capturedReviewFilesSchema = z
  .array(reviewFileSchema.extend({ diff: z.string() }))
  .max(100);
export const codeReviewFileSchema = z.object({
  file: reviewFileSchema.extend({ diff: z.string() }).nullable(),
  source: z.enum(['saved', 'snapshot', 'unavailable']),
});
export type ReviewFindingContinuity = z.infer<typeof reviewFindingContinuitySchema>;
export type ReviewContinuityReport = z.infer<typeof reviewContinuityReportSchema>;
export interface ReviewPriorFinding {
  reviewId: string;
  findingId: string;
  path: string;
  line: number;
  title: string;
  body: string;
  status: 'open' | 'fixed' | 'dismissed';
  resolution: string | null;
  verification: z.infer<typeof findingVerificationSchema>;
  comparison: 'same' | 'changed' | 'unknown';
  fingerprint: string | null;
  lastDecision: z.infer<typeof reviewDecisionSchema> | null;
  lastEvidence: z.infer<typeof reviewHistoricalEvidenceSchema> | null;
}
