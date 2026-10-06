import { z } from 'zod';

/** File operations and optional display patches reported by an agent. */
export const fileChangeSchema = z
  .object({
    operation: z.string(),
    path: z.string(),
    oldPath: z.string().optional(),
    fileType: z.string().nullish(),
    mimeType: z.string().nullish(),
  })
  .loose();
export const filePatchSchema = z.object({ format: z.string(), text: z.string() }).loose();
export const structuredDiffSchema = z
  .object({
    changes: z.array(fileChangeSchema),
    patch: filePatchSchema.nullish(),
  })
  .loose();
export type FileChange = z.infer<typeof fileChangeSchema>;
export type FilePatch = z.infer<typeof filePatchSchema>;
export const fileChangeStatsSchema = z.object({
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
});
export type FileChangeStats = z.infer<typeof fileChangeStatsSchema>;
