import { z } from 'zod';
import { sessionExecutionSchema } from '../schemas/session-execution.js';
import {
  createSessionSchema,
  handoffSessionSchema,
  handoffSessionResponseSchema,
  sessionWithCapabilitiesSchema,
  sessionRowSchema,
  thinkingEffortSchema,
} from '../schemas/session.js';

import { repositoryContract } from './repository.contract.js';
import { sessionGitContract } from './session-git.contract.js';

const emptyBodySchema = z.record(z.string(), z.unknown()).optional().default({});

export const sessionsContract = {
  ...repositoryContract,
  ...sessionGitContract,
  resumeSessionQueue: {
    method: 'POST',
    path: '/api/sessions/:id/queue/resume',
    pathParams: z.object({ id: z.uuid() }),
    body: emptyBodySchema,
    responses: {
      200: z.object({ success: z.literal(true) }),
      409: z.object({ message: z.string() }),
    },
    summary: 'Resume safely queued messages after a failure',
  },
  getSessionExecution: {
    method: 'GET',
    path: '/api/sessions/:id/execution',
    pathParams: z.object({ id: z.uuid() }),
    responses: { 200: sessionExecutionSchema },
    summary: 'Get execution state and accepted message queue',
  },
  changeQueuedMessage: {
    method: 'POST',
    path: '/api/sessions/:id/queue/:commandId',
    pathParams: z.object({ id: z.uuid(), commandId: z.string() }),
    body: z.discriminatedUnion('action', [
      z.object({ action: z.enum(['cancel', 'up', 'down']) }),
      z.object({ action: z.literal('edit'), input: z.string().trim().min(1) }),
    ]),
    responses: {
      200: z.object({ success: z.literal(true) }),
      409: z.object({ message: z.string() }),
    },
    summary: 'Edit, cancel, or reorder a message before dispatch',
  },
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
  cancelSession: {
    method: 'POST',
    path: '/api/sessions/:id/cancel',
    pathParams: z.object({
      id: z.uuid(),
    }),
    body: emptyBodySchema,
    responses: {
      200: z.object({ success: z.boolean() }),
    },
    summary: 'Cancel session run',
  },
  approveEvent: {
    method: 'POST',
    path: '/api/sessions/:id/approve',
    pathParams: z.object({
      id: z.uuid(),
    }),
    body: z.object({
      eventId: z.number(),
      optionId: z.string().optional(),
    }),
    responses: {
      200: z.object({ success: z.boolean() }),
    },
    summary: 'Approve pending session event',
  },
  denyEvent: {
    method: 'POST',
    path: '/api/sessions/:id/deny',
    pathParams: z.object({
      id: z.uuid(),
    }),
    body: z.object({
      eventId: z.number(),
    }),
    responses: {
      200: z.object({ success: z.boolean() }),
    },
    summary: 'Deny pending session event',
  },
  sendInput: {
    method: 'POST',
    path: '/api/sessions/:id/input',
    pathParams: z.object({
      id: z.uuid(),
    }),
    body: z.object({
      input: z.string(),
      clientMessageId: z.uuid().optional(),
      attachmentIds: z.array(z.string()).optional(),
    }),
    responses: {
      200: z.object({ success: z.literal(true), eventId: z.number() }),
      409: z.object({ success: z.literal(false), message: z.string() }),
    },
    summary: 'Send user input to session',
  },
  undoDiscard: {
    method: 'POST',
    path: '/api/sessions/:id/undo-discard',
    pathParams: z.object({ id: z.uuid() }),
    body: emptyBodySchema,
    responses: { 200: z.object({ success: z.boolean() }), 400: z.object({ message: z.string() }) },
  },
  rewindSession: {
    method: 'POST',
    path: '/api/sessions/:id/rewind',
    pathParams: z.object({
      id: z.uuid(),
    }),
    body: z.object({
      eventId: z.number(),
      mode: z.enum(['conversation', 'files', 'fork']),
    }),
    responses: {
      200: z.object({
        success: z.boolean(),
        forkSessionId: z.string().optional(),
        undoSnapshotHash: z.string().optional(),
        restoredFiles: z
          .array(
            z.object({
              path: z.string(),
              status: z.enum(['added', 'modified', 'deleted']),
              additions: z.number().optional(),
              deletions: z.number().optional(),
            }),
          )
          .optional(),
      }),
    },
    summary: 'Rewind session to a past event',
  },
  undoRewind: {
    method: 'POST',
    path: '/api/sessions/:id/undo-rewind',
    pathParams: z.object({
      id: z.uuid(),
    }),
    body: emptyBodySchema,
    responses: {
      200: z.object({
        success: z.boolean(),
      }),
    },
    summary: 'Undo session rewind, restoring both messages and files',
  },
  handoffSession: {
    method: 'POST',
    path: '/api/sessions/:id/handoff',
    pathParams: z.object({
      id: z.uuid(),
    }),
    body: handoffSessionSchema,
    responses: {
      200: handoffSessionResponseSchema,
      404: z.object({ message: z.string() }),
      409: z.object({ message: z.string() }),
    },
    summary: 'Handoff the current workspace and conversation context to another agent',
  },
  restoreSnapshot: {
    method: 'POST',
    path: '/api/sessions/:id/restore-snapshot',
    pathParams: z.object({
      id: z.uuid(),
    }),
    body: z.object({
      snapshotHash: z.string(),
    }),
    responses: {
      200: z.object({
        success: z.boolean(),
        backupHash: z.string().optional(),
      }),
    },
    summary: 'Restore workspace files to a specific snapshot hash',
  },
  previewSnapshotDiff: {
    method: 'GET',
    path: '/api/sessions/:id/snapshots/:eventId/preview',
    pathParams: z.object({
      id: z.uuid(),
      eventId: z.coerce.number(),
    }),
    responses: {
      200: z.object({
        hasSnapshot: z.boolean(),
        files: z.array(
          z.object({
            path: z.string(),
            status: z.enum(['added', 'modified', 'deleted']),
          }),
        ),
      }),
    },
    summary: 'Preview files changed since a turn snapshot',
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
