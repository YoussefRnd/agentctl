import { z } from 'zod';
import { reviewWalkthroughSchema, walkthroughProgressSchema } from './review-walkthrough.js';
import {
  reviewFindingContinuitySchema,
  reviewContinuityReportSchema,
} from './review-continuity.js';
import { findingVerificationSchema, verificationSummarySchema } from './review-verification.js';
import { reviewContextReportSchema } from './review-context.js';
import { revisionReferenceSchema } from './repository.js';

export const reviewFindingContentSchema = z.object({
  previousFindingId: z.uuid().optional(),
  severity: z.enum(['high', 'medium', 'low']),
  path: z
    .string()
    .min(1)
    .max(1024)
    .refine(
      (value) =>
        !value.includes('\\') &&
        !value.includes('\0') &&
        !value.startsWith('/') &&
        !/^[a-z]:/i.test(value) &&
        !value.split('/').some((part) => part === '..' || part === '.'),
      'Finding paths must be workspace-relative',
    ),
  line: z.number().int().positive(),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(2000),
});
export const codeReviewOutputSchema = z.object({
  walkthrough: reviewWalkthroughSchema.optional(),
  summary: z.string().trim().min(1).max(2000),
  findings: z.array(reviewFindingContentSchema).max(30),
});
export const reviewFindingSchema = reviewFindingContentSchema.extend({
  id: z.uuid(),
  status: z.enum(['open', 'fixed', 'dismissed']),
  resolution: z.string().max(2000).nullable(),
  verification: findingVerificationSchema.optional(),
  continuity: reviewFindingContinuitySchema.nullable().optional(),
});
export const codeReviewRunSchema = z.object({
  walkthrough: reviewWalkthroughSchema.nullable().optional(),
  walkthroughProgress: walkthroughProgressSchema.nullable().optional(),
  id: z.uuid(),
  sessionId: z.uuid(),
  providerId: z.string(),
  modelId: z.string(),
  scope: z.enum(['working', 'session']),
  fromRevision: revisionReferenceSchema,
  toRevision: revisionReferenceSchema,
  status: z.enum(['running', 'completed', 'failed', 'cancelled']),
  summary: z.string(),
  error: z.string().nullable(),
  startedAt: z.number(),
  finishedAt: z.number().nullable(),
  freshness: z.enum(['current', 'outdated', 'unknown']),
  findings: z.array(reviewFindingSchema),
  context: reviewContextReportSchema.nullable().optional(),
  verificationSummary: verificationSummarySchema.optional(),
  evidenceCheckIds: z.array(z.uuid()).optional(),
  continuity: reviewContinuityReportSchema.nullable().optional(),
});
export const startCodeReviewSchema = z.object({
  scope: z.enum(['working', 'session']).default('working'),
  evidenceReviewId: z.uuid().optional(),
  providerId: z.string().min(1).optional(),
  modelId: z.string().min(1).optional(),
});
export const resolveReviewFindingSchema = z
  .object({
    status: z.enum(['open', 'fixed', 'dismissed']),
    resolution: z.string().trim().max(2000).optional(),
  })
  .refine((value) => value.status !== 'dismissed' || !!value.resolution, {
    message: 'Give a reason when dismissing a finding',
    path: ['resolution'],
  });
export type CodeReviewRun = z.infer<typeof codeReviewRunSchema>;
export type ReviewFinding = z.infer<typeof reviewFindingSchema>;
export type CodeReviewOutput = z.infer<typeof codeReviewOutputSchema>;
export type StartCodeReview = z.infer<typeof startCodeReviewSchema>;
export type ResolveReviewFinding = z.infer<typeof resolveReviewFindingSchema>;
