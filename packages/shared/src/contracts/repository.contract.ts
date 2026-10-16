import { z } from 'zod';
import {
  repositoryInfoSchema,
  repositoryReviewSchema,
  revisionReferenceSchema,
} from '../schemas/repository.js';
import { reviewDiffScopeSchema } from '../schemas/review.js';

export const repositoryReviewQuerySchema = z
  .object({
    includeDiffs: z.enum(['true', 'false']).optional(),
    filePath: z.string().min(1).optional(),
    scope: reviewDiffScopeSchema.optional(),
    fromRevision: revisionReferenceSchema.optional(),
    toRevision: revisionReferenceSchema.optional(),
  })
  .refine(
    (query) =>
      (!query.fromRevision && !query.toRevision) ||
      (!!query.fromRevision && !!query.toRevision && !!query.filePath),
    { message: 'Captured diffs require both revision references and a file path' },
  );
export type RepositoryReviewQuery = z.infer<typeof repositoryReviewQuerySchema>;

export const repositoryContract = {
  getSessionRepository: {
    method: 'GET',
    path: '/api/sessions/:id/repository',
    pathParams: z.object({ id: z.uuid() }),
    responses: { 200: repositoryInfoSchema },
    summary: 'Get the workspace repository backend and supported capabilities',
  },
  getRepositoryReview: {
    method: 'GET',
    path: '/api/sessions/:id/repository/review',
    pathParams: z.object({ id: z.uuid() }),
    query: repositoryReviewQuerySchema,
    responses: { 200: repositoryReviewSchema },
    summary: 'Review workspace changes using backend-independent revision references',
  },
} as const;
