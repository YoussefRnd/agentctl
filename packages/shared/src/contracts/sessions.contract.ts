import { reviewFixContract } from './review-fix.contract.js';
import { reviewVerificationContract } from './review-verification.contract.js';
import { z } from 'zod';
import {
  createSessionSchema,
  sessionWithCapabilitiesSchema,
  sessionRowSchema,
  thinkingEffortSchema,
} from '../schemas/session.js';

import { codeReviewContract } from './code-review.contract.js';
import { repositoryContract } from './repository.contract.js';
import { sessionGitContract } from './session-git.contract.js';

import { emptyBodySchema } from './contract-common.js';

import { sessionExecutionContract } from './session-execution.contract.js';
import { sessionHistoryContract } from './session-history.contract.js';
export const sessionsContract = {
  ...sessionExecutionContract,
  ...sessionHistoryContract,
  ...repositoryContract,
  ...codeReviewContract,
  ...reviewVerificationContract,
  ...reviewFixContract,
  ...sessionGitContract,
  importNativeSession: {
    method: 'POST',
    path: '/api/sessions/import-native',
    body: z.object({
      projectId: z.uuid(),
      providerId: z.string().min(1),
      nativeSessionId: z.string().min(1),
      title: z.string().max(500).optional(),
    }),
    responses: { 200: z.object({ sessionId: z.uuid() }) },
    summary: 'Import and load an existing provider session',
  },
  getSessions: {
    method: 'GET',
    path: '/api/sessions',
    responses: {
      200: z.array(sessionRowSchema),
    },
    summary: 'Get all sessions',
  },
  createSession: {
    method: 'POST',
    path: '/api/sessions',
    body: createSessionSchema,
    responses: {
      201: sessionRowSchema,
    },
    summary: 'Create a new session',
  },
  getSessionById: {
    method: 'GET',
    path: '/api/sessions/:id',
    pathParams: z.object({
      id: z.uuid(),
    }),
    responses: {
      200: sessionWithCapabilitiesSchema,
    },
    summary: 'Get session by ID',
  },
  sendTerminalInput: {
    method: 'POST',
    path: '/api/sessions/:id/terminal/:terminalId/input',
    pathParams: z.object({
      id: z.uuid(),
      terminalId: z.string(),
    }),
    body: z.object({
      data: z.string(),
    }),
    responses: {
      200: z.object({ success: z.boolean() }),
    },
    summary: 'Send input to a running terminal process in the session',
  },
  mergeSession: {
    method: 'POST',
    path: '/api/sessions/:id/merge',
    pathParams: z.object({
      id: z.uuid(),
    }),
    body: z.object({
      commitMessage: z.string().optional(),
      targetBranch: z.string().min(1).optional(),
    }),
    responses: {
      200: z.object({ success: z.boolean() }),
      400: z.object({ message: z.string() }),
    },
    summary: 'Merge into the chosen local branch and close session',
  },
  discardSession: {
    method: 'POST',
    path: '/api/sessions/:id/discard',
    pathParams: z.object({
      id: z.uuid(),
    }),
    body: emptyBodySchema,
    responses: {
      200: z.object({ success: z.boolean() }),
      400: z.object({ message: z.string() }),
    },
    summary: 'Discard session changes and close',
  },
  patchSession: {
    method: 'PATCH',
    path: '/api/sessions/:id',
    pathParams: z.object({
      id: z.uuid(),
    }),
    body: z.object({
      title: z.string().optional(),
      pinned: z.boolean().optional(),
      settled: z.boolean().optional(),
      lastReadEventId: z.number().int().nonnegative().optional(),
      mode: z.enum(['local', 'worktree']).optional(),
      approvalMode: z.enum(['review', 'auto_approve', 'yolo']).optional(),
      persona: z.string().optional(),
      providerId: z.string().optional(),
      modelId: z.string().optional(),
      thinkingEffort: thinkingEffortSchema.optional(),
      configId: z.string().optional(),
      configValue: z.string().optional(),
      branch: z.string().optional(),
    }),
    responses: {
      200: sessionWithCapabilitiesSchema,
      409: z.object({ error: z.string() }),
    },
    summary: 'Update session attributes',
  },
  deleteSession: {
    method: 'DELETE',
    path: '/api/sessions/:id',
    pathParams: z.object({
      id: z.uuid(),
    }),
    responses: {
      204: z.void(),
    },
    summary: 'Delete session permanently',
  },
  archiveSession: {
    method: 'POST',
    path: '/api/sessions/:id/archive',
    pathParams: z.object({
      id: z.uuid(),
    }),
    body: emptyBodySchema,
    responses: {
      200: z.object({ success: z.boolean() }),
    },
    summary: 'Archive session worktree',
  },
  restoreSession: {
    method: 'POST',
    path: '/api/sessions/:id/restore',
    pathParams: z.object({
      id: z.uuid(),
    }),
    body: emptyBodySchema,
    responses: {
      200: z.object({ success: z.boolean() }),
    },
    summary: 'Restore archived session worktree',
  },
  undoDiscard: {
    method: 'POST',
    path: '/api/sessions/:id/undo-discard',
    pathParams: z.object({ id: z.uuid() }),
    body: emptyBodySchema,
    responses: { 200: z.object({ success: z.boolean() }), 400: z.object({ message: z.string() }) },
  },
  spawnParallelAgent: {
    method: 'POST',
    path: '/api/sessions/:id/agents',
    pathParams: z.object({
      id: z.uuid(),
    }),
    body: z.object({
      prompt: z.string(),
      title: z.string().optional(),
      taskSlug: z.string().optional(),
      providerId: z.string().optional(),
      modelId: z.string().optional(),
    }),
    responses: {
      201: z.object({
        session: sessionRowSchema,
      }),
    },
    summary: 'Spawn a parallel background agent in an isolated workspace',
  },
} as const;
