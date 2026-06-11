/* eslint-disable @typescript-eslint/no-deprecated */
import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { 
  createSessionSchema, 
  sessionWithCapabilitiesSchema,
  providerDiscoverySchema,
  sessionRowSchema
} from './session-schemas.js';

const c = initContract();

const patchSettingsSchema = z.object({
  onboardingCompleted: z.boolean().optional(),
  onboardingVersion: z.union([z.string(), z.number()]).optional(),
  setupStep: z.string().nullable().optional(),
  defaultProviderId: z.string().nullable().optional(),
});

const settingsResponseSchema = z.object({
  onboardingCompleted: z.boolean(),
  onboardingVersion: z.string(),
  setupStep: z.string().nullable(),
  defaultProviderId: z.string().nullable(),
});

const exploreResponseSchema = z.object({
  currentPath: z.string(),
  parentPath: z.string(),
  folders: z.array(z.object({
    name: z.string(),
    path: z.string(),
    isRepo: z.boolean(),
  })),
  error: z.string().optional(),
});

const reviewFileSchema = z.object({
  path: z.string(),
  status: z.enum(['added', 'modified', 'deleted', 'renamed', 'copied', 'untracked', 'ignored']),
  diff: z.string().optional(),
});

export const apiContract = c.router({
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
      200: z.array(z.any()),
    },
    summary: 'Get all projects',
  },
  getProviders: {
    method: 'GET',
    path: '/api/providers',
    responses: {
      200: z.array(providerDiscoverySchema),
    },
    summary: 'Discover providers',
  },
  loginProvider: {
    method: 'POST',
    path: '/api/providers/:id/login',
    pathParams: z.object({ id: z.string() }),
    body: z.object({
      methodId: z.string(),
      params: z.record(z.string(), z.any()).optional(),
    }),
    responses: {
      200: z.object({ success: z.boolean() }),
    },
    summary: 'Login to provider',
  },
  activateProvider: {
    method: 'POST',
    path: '/api/providers/:id/activate',
    pathParams: z.object({ id: z.string() }),
    body: z.any(),
    responses: {
      200: z.any(),
    },
    summary: 'Activate provider',
  },
  refreshProvider: {
    method: 'POST',
    path: '/api/providers/:id/refresh',
    pathParams: z.object({ id: z.string() }),
    body: z.any(),
    responses: {
      200: z.any(),
    },
    summary: 'Refresh provider',
  },
  toggleProvider: {
    method: 'POST',
    path: '/api/providers/:id/toggle',
    pathParams: z.object({ id: z.string() }),
    body: z.object({ enabled: z.boolean() }),
    responses: {
      200: z.any(),
    },
    summary: 'Toggle provider enabled state',
  },
  setProviderConfig: {
    method: 'POST',
    path: '/api/providers/:id/config',
    pathParams: z.object({ id: z.string() }),
    body: z.object({
      customEnv: z.record(z.string(), z.string()),
    }),
    responses: {
      200: z.any(),
    },
    summary: 'Set provider configuration',
  },
  syncProviders: {
    method: 'POST',
    path: '/api/providers/sync',
    body: z.any(),
    responses: {
      200: z.array(providerDiscoverySchema),
    },
    summary: 'Sync all providers',
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
      201: z.any(),
    },
    summary: 'Create a new session',
  },
  getSessionById: {
    method: 'GET',
    path: '/api/sessions/:id',
    pathParams: z.object({
      id: z.string().uuid(),
    }),
    responses: {
      200: sessionWithCapabilitiesSchema,
    },
    summary: 'Get session by ID',
  },
  getSessionBranches: {
    method: 'GET',
    path: '/api/sessions/:id/branches',
    pathParams: z.object({
      id: z.string().uuid(),
    }),
    responses: {
      200: z.array(z.string()),
    },
    summary: 'Get session git branches',
  },
  switchSessionBranch: {
    method: 'POST',
    path: '/api/sessions/:id/branch',
    pathParams: z.object({
      id: z.string().uuid(),
    }),
    body: z.object({
      branch: z.string(),
    }),
    responses: {
      200: z.object({ success: z.boolean() }),
    },
    summary: 'Switch session branch',
  },
  updateSessionProvider: {
    method: 'PATCH',
    path: '/api/sessions/:id/provider',
    pathParams: z.object({
      id: z.string().uuid(),
    }),
    body: z.object({
      providerId: z.string(),
      modelId: z.string().optional(),
    }),
    responses: {
      200: z.any(),
    },
    summary: 'Update session provider and model',
  },
  switchSessionMode: {
    method: 'PATCH',
    path: '/api/sessions/:id/mode',
    pathParams: z.object({
      id: z.string().uuid(),
    }),
    body: z.object({
      mode: z.enum(['local', 'worktree']),
    }),
    responses: {
      200: z.object({ success: z.boolean() }),
    },
    summary: 'Switch session execution mode',
  },
  setApprovalMode: {
    method: 'PATCH',
    path: '/api/sessions/:id/approval-mode',
    pathParams: z.object({
      id: z.string().uuid(),
    }),
    body: z.object({
      approvalMode: z.enum(['review', 'auto_approve', 'yolo']),
    }),
    responses: {
      200: z.any(),
    },
    summary: 'Update session approval mode',
  },
  mergeSession: {
    method: 'POST',
    path: '/api/sessions/:id/merge',
    pathParams: z.object({
      id: z.string().uuid(),
    }),
    body: z.object({
      commitMessage: z.string().optional(),
    }),
    responses: {
      200: z.any(),
    },
    summary: 'Merge and close session',
  },
  discardSession: {
    method: 'POST',
    path: '/api/sessions/:id/discard',
    pathParams: z.object({
      id: z.string().uuid(),
    }),
    body: z.any(),
    responses: {
      200: z.any(),
    },
    summary: 'Discard session changes and close',
  },
  deleteSession: {
    method: 'DELETE',
    path: '/api/sessions/:id',
    pathParams: z.object({
      id: z.string().uuid(),
    }),
    responses: {
      200: z.object({ success: z.boolean() }),
    },
    summary: 'Delete session permanently',
  },
  archiveSession: {
    method: 'POST',
    path: '/api/sessions/:id/archive',
    pathParams: z.object({
      id: z.string().uuid(),
    }),
    body: z.any(),
    responses: {
      200: z.object({ success: z.boolean() }),
    },
    summary: 'Archive session worktree',
  },
  restoreSession: {
    method: 'POST',
    path: '/api/sessions/:id/restore',
    pathParams: z.object({
      id: z.string().uuid(),
    }),
    body: z.any(),
    responses: {
      200: z.object({ success: z.boolean() }),
    },
    summary: 'Restore archived session worktree',
  },
  deleteProject: {
    method: 'DELETE',
    path: '/api/projects/:id',
    pathParams: z.object({
      id: z.string(),
    }),
    responses: {
      200: z.object({ success: z.boolean() }),
    },
    summary: 'Delete project permanently',
  },
  getSettings: {
    method: 'GET',
    path: '/api/settings',
    responses: {
      200: settingsResponseSchema,
    },
    summary: 'Get system settings',
  },
  patchSettings: {
    method: 'PATCH',
    path: '/api/settings',
    body: patchSettingsSchema,
    responses: {
      200: settingsResponseSchema,
    },
    summary: 'Update system settings',
  },
  exploreFs: {
    method: 'POST',
    path: '/api/fs/explore',
    body: z.object({
      path: z.string().optional(),
    }),
    responses: {
      200: exploreResponseSchema,
    },
    summary: 'Explore file system',
  },
  getSessionReview: {
    method: 'GET',
    path: '/api/sessions/:id/review',
    pathParams: z.object({
      id: z.string().uuid(),
    }),
    responses: {
      200: z.object({
        files: z.array(reviewFileSchema),
      }),
    },
    summary: 'Get session review files',
  },
  stageFile: {
    method: 'POST',
    path: '/api/sessions/:id/review/stage',
    pathParams: z.object({
      id: z.string().uuid(),
    }),
    body: z.object({
      filePath: z.string(),
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
      id: z.string().uuid(),
    }),
    body: z.object({
      filePath: z.string(),
    }),
    responses: {
      200: z.object({ success: z.boolean() }),
    },
    summary: 'Revert file changes',
  },
});
