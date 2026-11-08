import { z } from 'zod';

export const reviewFileSchema = z.object({
  path: z.string(),
  state: z.enum(['untracked', 'staged', 'modified', 'deleted', 'committed', 'conflicted']),
  diff: z.string().optional(),
  hasStagedChanges: z.boolean().optional(),
  hasUnstagedChanges: z.boolean().optional(),
  additions: z.number().optional(),
  deletions: z.number().optional(),
  sessionAdditions: z.number().optional(),
  sessionDeletions: z.number().optional(),
});
export type ReviewFileItem = z.infer<typeof reviewFileSchema>;

export type ReviewFile = ReviewFileItem & { diff: string };
export type ReviewFileState = ReviewFile['state'];

export const gitObjectHashSchema = z.string().regex(/^[0-9a-f]{40,64}$/i);
export const reviewCaptureSchema = z.object({
  currentTree: gitObjectHashSchema,
  workingTree: gitObjectHashSchema,
  sessionTree: gitObjectHashSchema,
});
export type ReviewCapture = z.infer<typeof reviewCaptureSchema>;

export const reviewResponseSchema = z.object({
  files: z.array(reviewFileSchema),
  capture: reviewCaptureSchema.optional(),
});
export type ReviewResponse = Omit<z.infer<typeof reviewResponseSchema>, 'files'> & {
  files: ReviewFile[];
};

export const reviewDiffScopeSchema = z.enum(['working', 'session']);
export type ReviewDiffScope = z.infer<typeof reviewDiffScopeSchema>;

export const reviewFreshnessSchema = z.enum(['current', 'outdated', 'unknown']);
export type ReviewFreshness = z.infer<typeof reviewFreshnessSchema>;
