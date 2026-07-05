/* eslint-disable @typescript-eslint/no-deprecated */
import { z } from 'zod';
import {
  createSessionSchema,
  sessionWithCapabilitiesSchema,
  providerDiscoverySchema,
  sessionRowSchema,
  sessionModeSchema,
  projectListRowSchema,
  mcpToolResultSchema,
} from './session-schemas.js';

export const mcpServerSchema = z.object({
  id: z.string(),
  name: z.string(),
  command: z.string().nullable().optional(),
  launchArgs: z.string().nullable().optional(),
  launchEnv: z.string().nullable().optional(),
  enabled: z.boolean(),
  autoApprove: z.boolean(),
  type: z.enum(['local', 'remote']).default('local'),
  url: z.string().nullable().optional(),
  headers: z.string().nullable().optional(),
  status: z.enum(['connected', 'disconnected', 'disabled']).optional(),
  error: z.string().nullable().optional(),
});

const patchSettingsSchema = z.object({
  onboardingCompleted: z.boolean().optional(),
  onboardingVersion: z.union([z.string(), z.number()]).optional(),
  setupStep: z.string().nullable().optional(),
  defaultProviderId: z.string().nullable().optional(),
  showThinking: z.boolean().optional(),
  registrySyncError: z.string().nullable().optional(),
});

const settingsResponseSchema = z.object({
  onboardingCompleted: z.boolean(),
  onboardingVersion: z.string(),
  setupStep: z.string().nullable(),
  defaultProviderId: z.string().nullable(),
  showThinking: z.boolean(),
  registrySyncError: z.string().nullable().optional(),
});

const exploreResponseSchema = z.object({
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

const reviewFileSchema = z.object({
  path: z.string(),
  state: z.enum(['untracked', 'staged', 'modified', 'deleted', 'committed', 'conflicted']),
  diff: z.string().optional(),
});

export const apiContract = {
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
    }),
    responses: {
      200: z.object({
        project: z.object({
          id: z.string(),
          name: z.string(),
          path: z.string(),
        }),
        session: sessionRowSchema,
        created: z.boolean(),
      }),
    },
    summary: 'Open project and session',
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
  logoutProvider: {
    method: 'POST',
    path: '/api/providers/:id/logout',
    pathParams: z.object({ id: z.string() }),
    body: z.any(),
    responses: {
      200: z.object({ success: z.boolean() }),
    },
    summary: 'Logout of provider',
  },
  activateProvider: {
    method: 'POST',
    path: '/api/providers/:id/activate',
    pathParams: z.object({ id: z.string() }),
    body: z.any(),
    responses: {
      200: providerDiscoverySchema,
    },
    summary: 'Activate provider',
  },
  refreshProvider: {
    method: 'POST',
    path: '/api/providers/:id/refresh',
    pathParams: z.object({ id: z.string() }),
    body: z.any(),
    responses: {
      200: providerDiscoverySchema,
    },
    summary: 'Refresh provider',
  },
  toggleProvider: {
    method: 'POST',
    path: '/api/providers/:id/toggle',
    pathParams: z.object({ id: z.string() }),
    body: z.object({ enabled: z.boolean() }),
    responses: {
      200: providerDiscoverySchema,
    },
    summary: 'Toggle provider enabled state',
  },
  setProviderConfig: {
    method: 'POST',
    path: '/api/providers/:id/config',
    pathParams: z.object({ id: z.string() }),
    body: z.object({
      customEnv: z.record(z.string(), z.string()).optional(),
      nativelyLoadsSkills: z.boolean().optional(),
    }),
    responses: {
      200: providerDiscoverySchema,
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
      201: sessionRowSchema,
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
      200: z.object({ success: z.boolean() }),
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
      200: z.object({ success: z.boolean() }),
    },
    summary: 'Update session approval mode',
  },
  setAgentPersona: {
    method: 'PATCH',
    path: '/api/sessions/:id/persona',
    pathParams: z.object({
      id: z.string().uuid(),
    }),
    body: z.object({
      persona: z.string(),
    }),
    responses: {
      200: z.object({ success: z.boolean() }),
    },
    summary: 'Update agent persona (ACP mode)',
  },
  setSessionConfigOption: {
    method: 'PATCH',
    path: '/api/sessions/:id/config-option',
    pathParams: z.object({
      id: z.string().uuid(),
    }),
    body: z.object({
      configId: z.string(),
      value: z.string(),
    }),
    responses: {
      200: z.object({ success: z.boolean() }),
    },
    summary: 'Set a session config option value',
  },
  sendTerminalInput: {
    method: 'POST',
    path: '/api/sessions/:id/terminal/:terminalId/input',
    pathParams: z.object({
      id: z.string().uuid(),
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
      id: z.string().uuid(),
    }),
    body: z.object({
      commitMessage: z.string().optional(),
    }),
    responses: {
      200: z.object({ success: z.boolean() }),
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
      200: z.object({ success: z.boolean() }),
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
  cancelSession: {
    method: 'POST',
    path: '/api/sessions/:id/cancel',
    pathParams: z.object({
      id: z.string().uuid(),
    }),
    body: z.any(),
    responses: {
      200: z.object({ success: z.boolean() }),
    },
    summary: 'Cancel session run',
  },
  approveEvent: {
    method: 'POST',
    path: '/api/sessions/:id/approve',
    pathParams: z.object({
      id: z.string().uuid(),
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
      id: z.string().uuid(),
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
      id: z.string().uuid(),
    }),
    body: z.object({
      input: z.string(),
      attachmentIds: z.array(z.string()).optional(),
    }),
    responses: {
      200: z.object({ success: z.boolean() }),
    },
    summary: 'Send user input to session',
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
  unstageFile: {
    method: 'POST',
    path: '/api/sessions/:id/review/unstage',
    pathParams: z.object({
      id: z.string().uuid(),
    }),
    body: z.object({
      filePath: z.string(),
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
      id: z.string().uuid(),
    }),
    body: z.any(),
    responses: {
      200: z.object({ success: z.boolean() }),
    },
    summary: 'Stage all files',
  },
  unstageAllFiles: {
    method: 'POST',
    path: '/api/sessions/:id/review/unstage-all',
    pathParams: z.object({
      id: z.string().uuid(),
    }),
    body: z.any(),
    responses: {
      200: z.object({ success: z.boolean() }),
    },
    summary: 'Unstage all files',
  },
  commitChanges: {
    method: 'POST',
    path: '/api/sessions/:id/review/commit',
    pathParams: z.object({
      id: z.string().uuid(),
    }),
    body: z.object({
      message: z.string(),
    }),
    responses: {
      200: z.object({ success: z.boolean() }),
    },
    summary: 'Commit staged changes locally',
  },
  pushChanges: {
    method: 'POST',
    path: '/api/sessions/:id/review/push',
    pathParams: z.object({
      id: z.string().uuid(),
    }),
    body: z.any(),
    responses: {
      200: z.object({ success: z.boolean(), output: z.string() }),
    },
    summary: 'Push local changes to remote repository',
  },
  pullChanges: {
    method: 'POST',
    path: '/api/sessions/:id/review/pull',
    pathParams: z.object({
      id: z.string().uuid(),
    }),
    body: z.any(),
    responses: {
      200: z.object({ success: z.boolean(), output: z.string() }),
    },
    summary: 'Pull changes from remote repository',
  },
  rewindSession: {
    method: 'POST',
    path: '/api/sessions/:id/rewind',
    pathParams: z.object({
      id: z.string().uuid(),
    }),
    body: z.object({
      eventId: z.number(),
      mode: z.enum(['conversation', 'files', 'fork']),
    }),
    responses: {
      200: z.object({
        success: z.boolean(),
        forkSessionId: z.string().optional(),
      }),
    },
    summary: 'Rewind session to a past event',
  },
  mergeSessionBranch: {
    method: 'POST',
    path: '/api/sessions/:id/merge-branch',
    pathParams: z.object({
      id: z.string().uuid(),
    }),
    body: z.object({
      branch: z.string(),
    }),
    responses: {
      200: z.object({ success: z.boolean() }),
    },
    summary: 'Merge parallel session branch into current session workspace',
  },
  getMcpServers: {
    method: 'GET',
    path: '/api/mcp-servers',
    responses: {
      200: z.array(mcpServerSchema),
    },
    summary: 'Get all MCP servers',
  },
  createMcpServer: {
    method: 'POST',
    path: '/api/mcp-servers',
    body: mcpServerSchema,
    responses: {
      200: mcpServerSchema,
    },
    summary: 'Register an MCP server',
  },
  updateMcpServer: {
    method: 'PATCH',
    path: '/api/mcp-servers/:id',
    pathParams: z.object({ id: z.string() }),
    body: mcpServerSchema.partial(),
    responses: {
      200: mcpServerSchema,
    },
    summary: 'Update MCP server config',
  },
  deleteMcpServer: {
    method: 'DELETE',
    path: '/api/mcp-servers/:id',
    pathParams: z.object({ id: z.string() }),
    responses: {
      200: z.object({ success: z.boolean() }),
    },
    summary: 'Delete MCP server',
  },
  getMcpTools: {
    method: 'GET',
    path: '/api/mcp/tools',
    responses: {
      200: z.array(
        z.object({
          name: z.string(),
          description: z.string().optional(),
          inputSchema: z.record(z.string(), z.any()),
          serverId: z.string(),
        }),
      ),
    },
    summary: 'Get all tools exposed by active MCP servers',
  },
  callMcpTool: {
    method: 'POST',
    path: '/api/mcp/tool/call',
    body: z.object({
      serverId: z.string(),
      toolName: z.string(),
      arguments: z.record(z.string(), z.any()),
    }),
    responses: {
      200: mcpToolResultSchema,
    },
    summary: 'Invoke a tool on a specific MCP server',
  },
} as const;
