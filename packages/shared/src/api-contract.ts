import { z } from 'zod';
import {
  createSessionSchema,
  sessionWithCapabilitiesSchema,
  providerDiscoverySchema,
  sessionRowSchema,
  sessionModeSchema,
  projectListRowSchema,
  mcpToolResultSchema,
} from './schemas/session.js';

export const mcpServerSchema = z.object({
  id: z.string(),
  name: z.string(),
  command: z.string().nullable().optional(),
  launchArgs: z.string().nullable().optional(),
  launchEnv: z.string().nullable().optional(),
  enabled: z.boolean(),
  autoApprove: z.boolean(),
  approvalPolicy: z
    .enum(['always_prompt', 'auto_approve_all', 'deny_all'])
    .default('always_prompt'),
  toolPermissions: z.string().nullable().optional().default('{}'),
  type: z.enum(['local', 'remote']).default('local'),
  url: z.string().nullable().optional(),
  headers: z.string().nullable().optional(),
  status: z.enum(['connected', 'disconnected', 'disabled']).optional(),
  error: z.string().nullable().optional(),
});

const fontContextSchema = z.object({
  family: z.string(),
  size: z.number().int().min(8).max(72),
});

const fontConfigSchema = z.object({
  ui: fontContextSchema.optional(),
  code: fontContextSchema.optional(),
});

const patchSettingsSchema = z.object({
  onboardingCompleted: z.boolean().optional(),
  onboardingVersion: z.union([z.string(), z.number()]).optional(),
  setupStep: z.string().nullable().optional(),
  defaultProviderId: z.string().nullable().optional(),
  showThinking: z.boolean().optional(),
  registrySyncError: z.string().nullable().optional(),
  fontConfig: fontConfigSchema.optional(),
});

const settingsResponseSchema = z.object({
  onboardingCompleted: z.boolean(),
  onboardingVersion: z.string(),
  setupStep: z.string().nullable(),
  defaultProviderId: z.string().nullable(),
  showThinking: z.boolean(),
  registrySyncError: z.string().nullable().optional(),
  fontConfig: z.object({
    ui: fontContextSchema,
    code: fontContextSchema,
  }),
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

export const reviewFileSchema = z.object({
  path: z.string(),
  state: z.enum(['untracked', 'staged', 'modified', 'deleted', 'committed', 'conflicted']),
  diff: z.string().optional(),
});

export type ReviewFileItem = z.infer<typeof reviewFileSchema>;

export const searchEventTypeSchema = z.enum(['user', 'agent', 'tool', 'thought']);
export type SearchEventType = z.infer<typeof searchEventTypeSchema>;

export const searchResultItemSchema = z.object({
  eventId: z.number(),
  sessionId: z.string(),
  sessionTitle: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  eventType: searchEventTypeSchema,
  snippet: z.string(),
  matchIndices: z.tuple([z.number(), z.number()]),
  createdAt: z.string(),
});

export type SearchResultItem = z.infer<typeof searchResultItemSchema>;

export const apiContract = {
  searchEvents: {
    method: 'GET',
    path: '/api/search/events',
    query: z.object({
      q: z.string().min(1),
      type: searchEventTypeSchema.or(z.literal('all')).optional(),
      projectId: z.string().optional(),
      sessionId: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
    }),
    responses: {
      200: z.array(searchResultItemSchema),
    },
    summary: 'Search session event transcripts',
  },
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
  getProviders: {
    method: 'GET',
    path: '/api/providers',
    responses: {
      200: z.array(providerDiscoverySchema),
    },
    summary: 'Discover providers',
  },
  getRegistry: {
    method: 'GET',
    path: '/api/registry',
    responses: {
      200: z.array(providerDiscoverySchema),
    },
    summary: 'Full registry catalog',
  },
  installProvider: {
    method: 'POST',
    path: '/api/providers/:id/install',
    pathParams: z.object({ id: z.string() }),
    body: z.any(),
    responses: {
      200: providerDiscoverySchema,
    },
    summary: 'Install provider',
  },
  removeProvider: {
    method: 'POST',
    path: '/api/providers/:id/remove',
    pathParams: z.object({ id: z.string() }),
    body: z.any(),
    responses: {
      200: providerDiscoverySchema,
    },
    summary: 'Remove provider',
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
      id: z.uuid(),
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
      id: z.uuid(),
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
      id: z.uuid(),
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
      id: z.uuid(),
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
      id: z.uuid(),
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
      id: z.uuid(),
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
      id: z.uuid(),
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
      id: z.uuid(),
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
      id: z.uuid(),
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
      id: z.uuid(),
    }),
    responses: {
      200: z.object({ success: z.boolean() }),
    },
    summary: 'Delete session permanently',
  },
  renameSession: {
    method: 'PATCH',
    path: '/api/sessions/:id/title',
    pathParams: z.object({
      id: z.uuid(),
    }),
    body: z.object({
      title: z.string(),
    }),
    responses: {
      200: z.object({ success: z.boolean() }),
    },
    summary: 'Rename session title',
  },
  archiveSession: {
    method: 'POST',
    path: '/api/sessions/:id/archive',
    pathParams: z.object({
      id: z.uuid(),
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
      id: z.uuid(),
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
      id: z.uuid(),
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
      id: z.uuid(),
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
      id: z.uuid(),
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
      id: z.uuid(),
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
      id: z.uuid(),
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
      id: z.uuid(),
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
      id: z.uuid(),
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
      id: z.uuid(),
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
      id: z.uuid(),
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
      id: z.uuid(),
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
    body: z.any(),
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
    method: 'POST',
    path: '/api/sessions/:id/check-merge',
    pathParams: z.object({
      id: z.uuid(),
    }),
    body: z.object({
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
      200: z.object({
        session: sessionRowSchema,
      }),
    },
    summary: 'Spawn a parallel background agent in an isolated workspace',
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
