import { z } from 'zod';
import { revisionReferenceSchema } from './repository.js';

export const reviewCheckStatusSchema = z.enum([
  'pending',
  'running',
  'passed',
  'failed',
  'error',
  'cancelled',
  'timed_out',
  'interrupted',
]);
export const reviewCheckSummarySchema = z.object({
  id: z.uuid(),
  reviewId: z.uuid(),
  name: z.string(),
  command: z.string(),
  commandRedacted: z.boolean(),
  status: reviewCheckStatusSchema,
  timeoutMs: z.number().int(),
  cwd: z.string(),
  expectedRevision: revisionReferenceSchema,
  checkedRevision: revisionReferenceSchema.nullable(),
  afterRevision: revisionReferenceSchema.nullable(),
  revisionState: z.enum(['unchanged', 'changed', 'unknown']),
  exitCode: z.number().int().nullable(),
  signal: z.string().nullable(),
  error: z.string().nullable(),
  startedAt: z.number(),
  finishedAt: z.number().nullable(),
  outputTruncated: z.boolean(),
});
export const reviewCheckResultSchema = reviewCheckSummarySchema.extend({
  stdout: z.string(),
  stderr: z.string(),
});
export const runReviewCheckSchema = z.object({
  name: z.string().trim().max(100).optional(),
  command: z
    .string()
    .trim()
    .min(1)
    .max(4000)
    .refine((value) => !value.includes('\0'), 'Commands cannot contain NUL bytes'),
  timeoutMs: z.number().int().min(1000).max(600_000).default(180_000),
});
export const findingVerificationSchema = z.object({
  state: z.enum(['suspected', 'reproduced']),
  checkId: z.uuid().nullable(),
  reason: z.string().nullable(),
  confirmedAt: z.number().nullable(),
});
export const confirmFindingEvidenceSchema = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('reproduced'),
    checkId: z.uuid(),
    reason: z.string().trim().min(10).max(2000),
  }),
  z.object({ state: z.literal('suspected'), reason: z.string().trim().max(2000).optional() }),
]);
export const verificationSummarySchema = z.object({
  total: z.number().int(),
  running: z.number().int(),
  passed: z.number().int(),
  failed: z.number().int(),
});
export type ReviewCheckSummary = z.infer<typeof reviewCheckSummarySchema>;
export type ReviewCheckResult = z.infer<typeof reviewCheckResultSchema>;
export type RunReviewCheck = z.infer<typeof runReviewCheckSchema>;
export type ConfirmFindingEvidence = z.infer<typeof confirmFindingEvidenceSchema>;
export type FindingVerification = z.infer<typeof findingVerificationSchema>;
export type VerificationSummary = z.infer<typeof verificationSummarySchema>;
/** App-recorded execution evidence, supplied as data through any ACP text session. */
export interface ReviewExecutionEvidence {
  checkId: string;
  name: string;
  command: string;
  status: 'passed' | 'failed';
  exitCode: number;
  startedAt: number;
  finishedAt: number;
  stdout: string;
  stderr: string;
  outputTruncated: boolean;
}
