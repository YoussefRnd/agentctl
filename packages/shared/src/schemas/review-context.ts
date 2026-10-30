import { z } from 'zod';

export const reviewContextRoleSchema = z.enum([
  'changed',
  'dependency',
  'reference',
  'test',
  'guidance',
]);
export const reviewContextFileSchema = z.object({
  path: z.string().min(1).max(4096),
  side: z.enum(['before', 'current']),
  role: reviewContextRoleSchema,
  ranges: z
    .array(
      z.object({ startLine: z.number().int().positive(), endLine: z.number().int().positive() }),
    )
    .max(8),
  complete: z.boolean(),
  characters: z.number().int().nonnegative(),
});
export const reviewContextReportSchema = z.object({
  version: z.literal(2),
  files: z.array(reviewContextFileSchema).max(40),
  omitted: z
    .array(
      z.object({
        path: z.string().max(4096),
        side: z.enum(['before', 'current']),
        reason: z.string().max(200),
      }),
    )
    .max(40),
  omittedCount: z.number().int().nonnegative(),
  limitations: z.array(z.string().max(500)).max(16),
  indexedFiles: z.number().int().nonnegative(),
  indexTruncated: z.boolean(),
  searchTruncated: z.boolean(),
  inputCharacters: z.number().int().nonnegative(),
});
export type ReviewContextReport = z.infer<typeof reviewContextReportSchema>;
export type ReviewContextFile = z.infer<typeof reviewContextFileSchema>;
export type ReviewContextRole = z.infer<typeof reviewContextRoleSchema>;
