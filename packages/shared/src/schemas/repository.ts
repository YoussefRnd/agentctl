import { z } from 'zod';
import { reviewFileSchema } from './review.js';

/** An opaque reference. Only the owning repository backend interprets its contents. */
export const revisionReferenceSchema = z.string().min(1).max(8192);
export type RevisionReference = z.infer<typeof revisionReferenceSchema>;

export const repositoryCapabilitiesSchema = z.object({
  review: z.boolean(),
  checkpoints: z.boolean(),
  comparisons: z.boolean(),
  restore: z.boolean(),
  isolation: z.boolean().default(false),
  integration: z.boolean().default(false),
  staging: z.boolean().default(false),
});
export type RepositoryCapabilities = z.infer<typeof repositoryCapabilitiesSchema>;

export const repositoryInfoSchema = z.object({
  backendId: z.string().min(1),
  repositoryId: z.string().min(1),
  workspaceId: z.string().min(1),
  workspacePath: z.string().min(1),
  rootPath: z.string().min(1),
  scope: z.string(),
  capabilities: repositoryCapabilitiesSchema,
});
export type SourceRepositoryInfo = z.infer<typeof repositoryInfoSchema>;

export const repositoryCaptureSchema = z.object({
  current: revisionReferenceSchema,
  working: revisionReferenceSchema,
  baseline: revisionReferenceSchema,
});
export type RepositoryCapture = z.infer<typeof repositoryCaptureSchema>;

export const repositoryReviewSchema = z.object({
  repository: repositoryInfoSchema.optional(),
  files: z.array(reviewFileSchema),
  capture: repositoryCaptureSchema.optional(),
});
export type RepositoryReview = Omit<z.infer<typeof repositoryReviewSchema>, 'files'> & {
  files: Array<z.infer<typeof reviewFileSchema> & { diff: string }>;
};
