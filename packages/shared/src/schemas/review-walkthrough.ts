import { z } from 'zod';
import { repositoryCaptureSchema } from './repository.js';
import { reviewFreshnessSchema } from './review.js';
const excerpt = z.object({
  path: z.string().min(1).max(1024),
  side: z.enum(['old', 'new']),
  line: z.number().int().positive(),
});
export const reviewWalkthroughStopSchema = z.object({
  title: z.string().trim().min(1).max(160),
  summary: z.string().trim().min(1).max(800),
  excerpts: z.array(excerpt).max(8),
  files: z.array(z.string().min(1).max(1024)).max(100),
});
export const reviewWalkthroughSchema = z.array(reviewWalkthroughStopSchema).min(1).max(9);
export const walkthroughProgressSchema = z.object({
  position: z.number().int().min(0),
  seen: z.array(z.number().int().min(0)).max(9),
});
export const updateWalkthroughProgressSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('navigate'), position: z.number().int().min(0) }),
  z.object({ action: z.literal('mark'), position: z.number().int().min(0), seen: z.boolean() }),
  z.object({ action: z.literal('reset') }),
]);
export const walkthroughQuestionSchema = z.object({
  prompt: z.string(),
  freshness: reviewFreshnessSchema,
  capture: repositoryCaptureSchema.nullable(),
});
export type ReviewWalkthroughStop = z.infer<typeof reviewWalkthroughStopSchema>;
export type WalkthroughProgress = z.infer<typeof walkthroughProgressSchema>;
export type UpdateWalkthroughProgress = z.infer<typeof updateWalkthroughProgressSchema>;
export type WalkthroughQuestion = z.infer<typeof walkthroughQuestionSchema>;
