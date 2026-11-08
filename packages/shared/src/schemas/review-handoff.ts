import { z } from 'zod';
import { repositoryCaptureSchema } from './repository.js';
import { reviewFreshnessSchema } from './review.js';

export const reviewHandoffIntentSchema = z.enum(['ask', 'fix']);
export const prepareReviewHandoffSchema = z.object({
  intent: reviewHandoffIntentSchema,
  notes: z.string().trim().max(2000).default(''),
});
export const reviewHandoffSnippetSchema = z.object({
  status: z.enum(['text', 'missing', 'binary', 'too_large', 'symlink', 'submodule', 'unavailable']),
  side: z.enum(['old', 'new']),
  lines: z.array(z.object({ line: z.number().int().positive(), text: z.string() })),
  truncated: z.boolean(),
});
export const reviewHandoffSchema = z.object({
  intent: reviewHandoffIntentSchema,
  freshness: reviewFreshnessSchema,
  checkedAt: z.number(),
  capture: repositoryCaptureSchema.nullable(),
  location: z.enum(['original', 'moved', 'ambiguous', 'changed', 'unavailable']),
  currentLine: z.number().int().positive().nullable(),
  reviewed: reviewHandoffSnippetSchema,
  current: reviewHandoffSnippetSchema,
  canAdd: z.boolean(),
  blockedReason: z.string().nullable(),
  evidenceCount: z.number().int(),
  prompt: z.string(),
  truncated: z.boolean(),
});
export type ReviewHandoffIntent = z.infer<typeof reviewHandoffIntentSchema>;
export type PrepareReviewHandoff = z.infer<typeof prepareReviewHandoffSchema>;
export type ReviewHandoff = z.infer<typeof reviewHandoffSchema>;
export type ReviewHandoffSnippet = z.infer<typeof reviewHandoffSnippetSchema>;
