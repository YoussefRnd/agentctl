import { z } from 'zod';
import {
  reviewResponseSchema,
  reviewDiffScopeSchema,
  gitObjectHashSchema,
} from '../schemas/review.js';
import {
  gitStatusSchema,
  createPullRequestBodySchema,
  createPullRequestResultSchema,
} from './projects.contract.js';

import { emptyBodySchema } from './contract-common.js';

export const sessionGitContract = {
  getSessionBranches: {
    method: 'GET',
    path: '/api/sessions/:id/branches',
    pathParams: z.object({
      id: z.uuid(),
    }),
    responses: {
      200: z.array(z.string()),
    },
    summary: 'Get session git branches',
  },
  getSessionMergePreview: {
    method: 'GET',
    path: '/api/sessions/:id/merge-preview',
    pathParams: z.object({ id: z.uuid() }),
    query: z.object({ targetBranch: z.string().min(1).optional() }),
    responses: {
      200: z.object({
        baseBranch: z.string(),
        targetPath: z.string().nullable(),
        uncommittedCount: z.number(),
        hasMergeHead: z.boolean(),
        blockedReason: z.string().nullable(),
        hasConflicts: z.boolean(),
        conflictingFiles: z.array(z.string()),
      }),
      400: z.object({ message: z.string() }),
    },
    summary: 'Check the destination and workspace before merging a worktree session',
  },
  // Compatibility endpoint for clients that still send Git object hashes.
  getSessionReview: {
    query: z
      .object({
        includeDiffs: z.enum(['true', 'false']).optional(),
        filePath: z.string().min(1).optional(),
        scope: reviewDiffScopeSchema.optional(),
        fromHash: gitObjectHashSchema.optional(),
        toHash: gitObjectHashSchema.optional(),
      })
      .refine(
        (query) =>
          (!query.fromHash && !query.toHash) ||
          (!!query.fromHash && !!query.toHash && !!query.filePath),
        { message: 'Captured diffs require both hashes and a file path' },
      ),
    method: 'GET',
    path: '/api/sessions/:id/review',
    pathParams: z.object({
      id: z.uuid(),
    }),
    responses: {
      200: reviewResponseSchema,
    },
    summary: 'Get session review files',
  },
  stageFile: {
    method: 'POST',
    path: '/api/sessions/:id/review/stage',
    pathParams: z.object({
      id: z.uuid(),
    }),
    body: z.object({
      filePath: z.string().min(1),
    }),
    responses: {
      200: z.object({ success: z.boolean() }),
    },
    summary: 'Stage file for commit',
  },
  revertFile: {
    method: 'POST',
    path: '/api/sessions/:id/review/revert',
    pathParams: z.object({
      id: z.uuid(),
    }),
    body: z.object({
      filePath: z.string().min(1),
    }),
    responses: {
      200: z.object({ success: z.boolean() }),
    },
    summary: 'Revert file changes',
  },
  unstageFile: {
    method: 'POST',
    path: '/api/sessions/:id/review/unstage',
    pathParams: z.object({
      id: z.uuid(),
    }),
    body: z.object({
      filePath: z.string().min(1),
    }),
    responses: {
      200: z.object({ success: z.boolean() }),
    },
    summary: 'Unstage file changes',
  },
  stageAllFiles: {
    method: 'POST',
    path: '/api/sessions/:id/review/stage-all',
    pathParams: z.object({
      id: z.uuid(),
    }),
    body: emptyBodySchema,
    responses: {
      200: z.object({ success: z.boolean() }),
    },
    summary: 'Stage all files',
  },
  unstageAllFiles: {
    method: 'POST',
    path: '/api/sessions/:id/review/unstage-all',
    pathParams: z.object({
      id: z.uuid(),
    }),
    body: emptyBodySchema,
    responses: {
      200: z.object({ success: z.boolean() }),
    },
    summary: 'Unstage all files',
  },
  commitChanges: {
    method: 'POST',
    path: '/api/sessions/:id/review/commit',
    pathParams: z.object({
      id: z.uuid(),
    }),
    body: z.object({
      message: z.string().trim().min(1),
      includeUnstaged: z.boolean().optional(),
    }),
    responses: {
      200: z.object({ success: z.boolean() }),
      400: z.object({ message: z.string() }),
    },
    summary: 'Commit staged changes locally',
  },
  pushChanges: {
    method: 'POST',
    path: '/api/sessions/:id/review/push',
    pathParams: z.object({
      id: z.uuid(),
    }),
    body: emptyBodySchema,
    responses: {
      200: z.object({ success: z.boolean(), output: z.string() }),
      400: z.object({ message: z.string() }),
    },
    summary: 'Push local changes to remote repository',
  },
  pullChanges: {
    method: 'POST',
    path: '/api/sessions/:id/review/pull',
    pathParams: z.object({
      id: z.uuid(),
    }),
    body: emptyBodySchema,
    responses: {
      200: z.object({ success: z.boolean(), output: z.string() }),
      400: z.object({ message: z.string() }),
    },
    summary: 'Pull changes from remote repository',
  },
  fetchChanges: {
    method: 'POST',
    path: '/api/sessions/:id/git/fetch',
    pathParams: z.object({ id: z.uuid() }),
    body: emptyBodySchema,
    responses: {
      200: z.object({ success: z.boolean(), output: z.string() }),
      400: z.object({ message: z.string() }),
    },
  },
  createSessionBranch: {
    method: 'POST',
    path: '/api/sessions/:id/git/branches',
    pathParams: z.object({ id: z.uuid() }),
    body: z.object({ name: z.string().trim().min(1) }),
    responses: { 200: z.object({ success: z.boolean() }), 400: z.object({ message: z.string() }) },
  },
  getGitStatus: {
    method: 'GET',
    path: '/api/sessions/:id/git/status',
    pathParams: z.object({
      id: z.uuid(),
    }),
    responses: {
      200: gitStatusSchema,
    },
    summary: 'Get Git tracking status and active PR for session',
  },
  generateGitDraft: {
    method: 'POST',
    path: '/api/sessions/:id/git/generate-draft',
    pathParams: z.object({ id: z.uuid() }),
    body: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('commit'), includeUnstaged: z.boolean().optional() }),
      z.object({ kind: z.literal('merge'), targetBranch: z.string().trim().min(1) }),
      z.object({ kind: z.literal('pr'), targetBranch: z.string().trim().min(1) }),
    ]),
    responses: {
      200: z.object({ title: z.string(), body: z.string() }),
      400: z.object({ message: z.string() }),
    },
    summary: 'Generate an editable draft using the session provider without changing Git state',
  },
  createPullRequest: {
    method: 'POST',
    path: '/api/sessions/:id/git/pull-request',
    pathParams: z.object({
      id: z.uuid(),
    }),
    body: createPullRequestBodySchema,
    responses: {
      200: createPullRequestResultSchema,
      400: z.object({ message: z.string() }),
    },
    summary: 'Push the current branch and create or locate its pull request',
  },
  mergeSessionBranch: {
    method: 'POST',
    path: '/api/sessions/:id/merge-branch',
    pathParams: z.object({
      id: z.uuid(),
    }),
    body: z.object({
      branch: z.string(),
    }),
    responses: {
      200: z.object({ success: z.boolean() }),
    },
    summary: 'Merge parallel session branch into current session workspace',
  },
  checkMergeBranch: {
    method: 'GET',
    path: '/api/sessions/:id/check-merge',
    pathParams: z.object({
      id: z.uuid(),
    }),
    query: z.object({
      branch: z.string(),
    }),
    responses: {
      200: z.object({
        canMerge: z.boolean(),
        hasConflicts: z.boolean(),
        conflictingFiles: z.array(z.string()),
      }),
    },
    summary: 'Pre-check if merging a branch into current session produces conflicts',
  },
} as const;
