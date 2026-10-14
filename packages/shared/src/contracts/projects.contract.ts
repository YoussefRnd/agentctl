import { z } from 'zod';
import { projectListRowSchema, sessionRowSchema, sessionModeSchema } from '../schemas/session.js';

export const exploreResponseSchema = z.object({
  currentPath: z.string(),
  parentPath: z.string(),
  folders: z.array(
    z.object({
      name: z.string(),
      path: z.string(),
      isRepo: z.boolean(),
    }),
  ),
  error: z.string().optional(),
});

export { reviewFileSchema, type ReviewFileItem } from '../schemas/review.js';

export const gitPullRequestSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  url: z.string(),
  baseBranch: z.string(),
  headBranch: z.string(),
  state: z.enum(['open', 'closed', 'merged']),
});
export type GitPullRequest = z.infer<typeof gitPullRequestSchema>;

export const gitStatusSchema = z.object({
  lastFetchedAt: z.string().nullable().optional(),
  isRepo: z.boolean(),
  branch: z.string().nullable(),
  hasPrimaryRemote: z.boolean(),
  remoteName: z.string().nullable(),
  remoteProvider: z.enum(['github', 'other']).nullable(),
  upstreamBranch: z.string().nullable(),
  hasUpstream: z.boolean(),
  aheadCount: z.number().int().nonnegative(),
  behindCount: z.number().int().nonnegative(),
  pr: gitPullRequestSchema.nullable(),
  error: z.string().optional(),
});
export type GitStatus = z.infer<typeof gitStatusSchema>;

export const createPullRequestBodySchema = z.object({
  title: z.string().trim().min(1),
  body: z.string(),
  baseBranch: z.string().trim().min(1),
  headBranch: z.string().trim().min(1).optional(),
});
export type CreatePullRequestBody = z.infer<typeof createPullRequestBodySchema>;

export const createPullRequestResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('created'),
    pr: gitPullRequestSchema,
  }),
  z.object({
    status: z.literal('already_exists'),
    pr: gitPullRequestSchema,
  }),
  z.object({
    status: z.literal('needs_browser'),
    compareUrl: z.url(),
  }),
]);
export type CreatePullRequestResult = z.infer<typeof createPullRequestResultSchema>;

export const projectsContract = {
  getProjects: {
    method: 'GET',
    path: '/api/projects',
    query: z.object({
      search: z.string().optional(),
      gitOnly: z.enum(['true', 'false']).optional(),
      sortBy: z.enum(['name', 'lastActive', 'createdAt']).optional(),
      sortOrder: z.enum(['asc', 'desc']).optional(),
    }),
    responses: {
      200: z.array(projectListRowSchema),
    },
    summary: 'Get all projects',
  },
  openProject: {
    method: 'POST',
    path: '/api/projects/open',
    body: z.object({
      path: z.string(),
      agent: z.string().optional(),
      taskSlug: z.string().optional(),
      mode: sessionModeSchema.optional(),
      startSession: z.boolean().optional(),
    }),
    responses: {
      200: z.object({
        project: z.object({
          id: z.string(),
          name: z.string(),
          path: z.string(),
        }),
        session: sessionRowSchema.nullable(),
        created: z.boolean(),
      }),
    },
    summary: 'Open project and session',
  },
  getAvailableEditors: {
    method: 'GET',
    path: '/api/editor/available',
    responses: {
      200: z.array(z.string()),
    },
    summary: 'List available editors detected on host system',
  },
  openInEditor: {
    method: 'POST',
    path: '/api/editor/open',
    body: z.object({
      editor: z.string(),
      path: z.string(),
    }),
    responses: {
      200: z.object({
        success: z.boolean(),
        editor: z.string(),
      }),
      400: z.object({
        message: z.string(),
      }),
      500: z.object({
        message: z.string(),
      }),
    },
    summary: 'Launch external editor, file manager, or terminal',
  },
  deleteProject: {
    method: 'DELETE',
    path: '/api/projects/:id',
    pathParams: z.object({
      id: z.string(),
    }),
    responses: {
      204: z.void(),
    },
    summary: 'Delete project permanently',
  },
  exploreFs: {
    method: 'GET',
    path: '/api/fs',
    query: z.object({
      path: z.string().optional(),
    }),
    responses: {
      200: exploreResponseSchema,
    },
    summary: 'Explore file system',
  },
} as const;
