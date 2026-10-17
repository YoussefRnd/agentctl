import { z } from 'zod';
import { emptyBodySchema } from './contract-common.js';
export const sessionHistoryContract = {
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
} as const;
