import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
  primaryKey,
  check,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';
import { relations, sql } from 'drizzle-orm';
import type {
  AuthState,
  ConnectionState,
  InstallSource,
  InstallStage,
  InstallState,
  SessionStatus,
  SessionEvent,
  SessionMode,
} from '@agentctl/shared';
import { DEFAULT_AGENT_MODEL, DEFAULT_CONTEXT_LIMIT } from '../config/runtime-defaults.js';

// Timestamps with DB-level defaults and auto-update on updatedAt
const timestamps = {
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`)
    .$onUpdateFn(() => new Date()),
};

// Conversation rows keep their creation time; changes have a separate sequence.
const eventTimestamps = {
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
};

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** The user-selected directory (may be a subdirectory of the git repo). */
  path: text('path').notNull(),
  /** Absolute path to the git repo root. Null if the folder is not inside a git repo. */
  repoRoot: text('repo_root'),
  /** Relative path from repoRoot to `path` (e.g. "apps/web"). Empty string if path == repoRoot. */
  subdir: text('subdir').notNull().default(''),
  ...timestamps,
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  branch: text('branch').notNull(),
  worktreePath: text('worktree_path').notNull(),
  taskSlug: text('task_slug').notNull(),
  title: text('title').notNull().default('new session'),
  baseCommit: text('base_commit').notNull(),
  baseBranch: text('base_branch'),
  discardBackup: text('discard_backup'),
  agent: text('agent').notNull(),
  agentSessionId: text('agent_session_id'),
  selectedProvider: text('selected_provider').notNull(),
  selectedModel: text('selected_model').notNull().default(DEFAULT_AGENT_MODEL),
  selectedThinkingEffort: text('selected_thinking_effort'),
  mode: text('mode').$type<SessionMode>().notNull().default('local'),
  approvalMode: text('approval_mode')
    .$type<'review' | 'auto_approve' | 'yolo'>()
    .notNull()
    .default('review'),
  status: text('status').$type<SessionStatus>().notNull().default('idle'),
  totalTokens: integer('total_tokens').notNull().default(0),
  contextLimit: integer('context_limit').notNull().default(DEFAULT_CONTEXT_LIMIT),
  estimatedCost: real('estimated_cost').notNull().default(0.0),
  lastHeartbeat: integer('last_heartbeat', { mode: 'timestamp' }),
  closedAt: integer('closed_at', { mode: 'timestamp' }),
  availableCommands: text('available_commands').notNull().default('[]'),
  planArtifacts: text('plan_artifacts').notNull().default('[]'),
  plan: text('plan').notNull().default('[]'),
  sessionConfigOptions: text('session_config_options').notNull().default('[]'),
  sessionMetrics: text('session_metrics').notNull().default('{}'), // JSON string for breakdown, costs, etc.
  agentPersona: text('agent_persona'),
  availableAgentPersonas: text('available_agent_personas').notNull().default('[]'),
  lastActivityAt: integer('last_activity_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  ...timestamps,
});

export const sessionOperations = sqliteTable(
  'session_operations',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    queuePosition: integer('queue_position').notNull().default(0),
    commandId: text('command_id').notNull(),
    kind: text('kind').notNull(),
    fingerprint: text('fingerprint').notNull(),
    traceparent: text('traceparent'),
    payload: text('payload').notNull(),
    status: text('status')
      .$type<'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'unknown'>()
      .notNull(),
    eventId: integer('event_id'),
    error: text('error'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('session_operations_command').on(table.sessionId, table.commandId),
    index('session_operations_pending').on(table.sessionId, table.status),
  ],
);

export const sessionTurnAttempts = sqliteTable(
  'session_turn_attempts',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    operationId: text('operation_id')
      .notNull()
      .references(() => sessionOperations.id, { onDelete: 'cascade' }),
    runtimeId: text('runtime_id'),
    providerId: text('provider_id').notNull(),
    nativeSessionId: text('native_session_id'),
    status: text('status')
      .$type<
        | 'queued'
        | 'running'
        | 'waiting'
        | 'completed'
        | 'failed'
        | 'cancelled'
        | 'interrupted'
        | 'unknown'
      >()
      .notNull(),
    dispatchedAt: integer('dispatched_at', { mode: 'timestamp' }),
    startedAt: integer('started_at', { mode: 'timestamp' }),
    endedAt: integer('ended_at', { mode: 'timestamp' }),
    ...timestamps,
  },
  (table) => [
    index('session_turn_attempts_session').on(table.sessionId),
    index('session_turn_attempts_operation').on(table.operationId),
  ],
);

export const sessionRuntimeBindings = sqliteTable('session_runtime_bindings', {
  id: text('id').primaryKey(),
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  providerId: text('provider_id').notNull(),
  nativeSessionId: text('native_session_id'),
  connectionState: text('connection_state').$type<'connected' | 'closed' | 'lost'>().notNull(),
  capabilities: text('capabilities').notNull().default('{}'),
  ...timestamps,
});

/** What AgentCtl has delivered to a particular provider-owned conversation. */
export const sessionSkillCatalogs = sqliteTable(
  'session_skill_catalogs',
  {
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    providerId: text('provider_id').notNull(),
    nativeSessionId: text('native_session_id').notNull(),
    catalogHash: text('catalog_hash'),
    compactionId: text('compaction_id'),
  },
  (table) => [primaryKey({ columns: [table.sessionId, table.providerId, table.nativeSessionId] })],
);

/** Immutable cursor entries reference the latest conversation row, not duplicated bodies. */
export const sessionEventChanges = sqliteTable(
  'session_event_changes',
  {
    sequence: integer('sequence').primaryKey({ autoIncrement: true }),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    eventId: integer('event_id').notNull(),
    ...eventTimestamps,
  },
  (table) => [index('session_event_changes_cursor').on(table.sessionId, table.sequence)],
);

/** Migration-owned INSERT/DELETE triggers keep this count transactional across connections. */
export const sessionEventChangeCounts = sqliteTable(
  'session_event_change_counts',
  {
    sessionId: text('session_id')
      .primaryKey()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    retainedCount: integer('retained_count').notNull().default(0),
  },
  (table) => [check('session_event_change_counts_nonnegative', sql`${table.retainedCount} >= 0`)],
);

export const providers = sqliteTable('providers', {
  id: text('id').primaryKey(),
  registryAgentId: text('registry_agent_id'),
  customModels: text('custom_models').notNull().default('[]'),
  protocol: text('protocol').$type<'auto' | 'v1' | 'v2'>().notNull().default('auto'),
  defaultModel: text('default_model'),
  defaultThinkingEffort: text('default_thinking_effort'),
  name: text('name').notNull(),
  installState: text('install_state').$type<InstallState>().notNull().default('not_installed'),
  installError: text('install_error'),
  installStage: text('install_stage').$type<InstallStage>(),
  installSource: text('install_source').$type<InstallSource>(),
  installedVersion: text('installed_version'),
  connectionState: text('connection_state').$type<ConnectionState>().notNull().default('unknown'),
  authState: text('auth_state').$type<AuthState>().notNull().default('unknown'),
  authError: text('auth_error'),
  lastVerifiedAt: integer('last_verified_at', { mode: 'timestamp' }),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
  distribution: text('distribution').notNull().default('{}'),
  command: text('command').notNull(),
  launchArgs: text('launch_args').notNull().default('[]'), // JSON string
  launchEnv: text('launch_env').notNull().default('{}'), // JSON string
  configOptions: text('config_options').notNull().default('[]'), // JSON string
  authMethods: text('auth_methods').notNull().default('[]'), // JSON string
  version: text('version'),
  description: text('description'),
  icon: text('icon'),
  customEnv: text('custom_env').notNull().default('{}'), // JSON map of env names to encrypted-vault references
  supportsDynamicModel: integer('supports_dynamic_model', { mode: 'boolean' })
    .notNull()
    .default(false),
  supportsDynamicConfig: integer('supports_dynamic_config', { mode: 'boolean' })
    .notNull()
    .default(false),
  supportsLogout: integer('supports_logout', { mode: 'boolean' }).notNull().default(false),
  features: text('features').notNull().default('{}'),
  capabilitySnapshot: text('capability_snapshot'),
  nativelyLoadsSkills: integer('natively_loads_skills', { mode: 'boolean' })
    .notNull()
    .default(false),
  modes: text('modes').notNull().default('[]'), // JSON string array of advertised agent modes
  ...timestamps,
});

export const systemSettings = sqliteTable('system_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  ...timestamps,
});

export const registrySnapshots = sqliteTable('registry_snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  data: text('data').notNull(), // Raw registry JSON string
  etag: text('etag'),
  lastModified: text('last_modified'),
  fetchedAt: integer('fetched_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const authSessions = sqliteTable(
  'auth_sessions',
  {
    id: text('id').primaryKey(),
    clientLabel: text('client_label').notNull(),
    ip: text('ip').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    lastActiveAt: integer('last_active_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
    revokedAt: integer('revoked_at', { mode: 'timestamp' }),
  },
  (table) => [index('auth_sessions_expires_at_idx').on(table.expiresAt)],
);

export const sessionEvents = sqliteTable(
  'session_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    parentEventId: integer('parent_event_id').references((): AnySQLiteColumn => sessionEvents.id, {
      onDelete: 'cascade',
    }),
    type: text('type').$type<SessionEvent['type']>().notNull(),
    clientMessageId: text('client_message_id'),
    data: text('data').notNull(), // JSON string
    metadata: text('metadata'), // JSON string
    ...eventTimestamps,
  },
  (table) => [
    index('session_events_session_id_idx').on(table.sessionId),
    uniqueIndex('session_events_client_message_idx').on(table.sessionId, table.clientMessageId),
  ],
);

export const projectRelations = relations(projects, ({ many }) => ({
  sessions: many(sessions),
}));

export const sessionRelations = relations(sessions, ({ one, many }) => ({
  project: one(projects, {
    fields: [sessions.projectId],
    references: [projects.id],
  }),
  events: many(sessionEvents),
}));

export const sessionEventRelations = relations(sessionEvents, ({ one, many }) => ({
  session: one(sessions, {
    fields: [sessionEvents.sessionId],
    references: [sessions.id],
  }),
  parent: one(sessionEvents, {
    fields: [sessionEvents.parentEventId],
    references: [sessionEvents.id],
    relationName: 'event_hierarchy',
  }),
  children: many(sessionEvents, {
    relationName: 'event_hierarchy',
  }),
}));

export const mcpServers = sqliteTable('mcp_servers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  command: text('command'), // Nullable since remote servers don't run commands
  launchArgs: text('launch_args').notNull().default('[]'), // JSON string array
  launchEnv: text('launch_env').notNull().default('{}'), // JSON string object (can contain secrets)
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),

  // Server-level default policy
  approvalPolicy: text('approval_policy')
    .$type<'always_prompt' | 'auto_approve_all' | 'deny_all'>()
    .notNull()
    .default('always_prompt'),

  // JSON string for per-tool overrides
  toolPermissions: text('tool_permissions').notNull().default('{}'),

  type: text('type').notNull().default('local'), // 'local' or 'remote'
  url: text('url'),
  headers: text('headers'), // JSON string for HTTP headers
  ...timestamps,
  autoApprove: integer('auto_approve', { mode: 'boolean' }).notNull().default(false),
});

export const nativeSessionImports = sqliteTable(
  'native_session_imports',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    providerId: text('provider_id').notNull(),
    nativeSessionId: text('native_session_id').notNull(),
    completed: integer('completed', { mode: 'boolean' }).notNull().default(false),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
  },
  (table) => [
    uniqueIndex('native_session_import_identity').on(
      table.projectId,
      table.providerId,
      table.nativeSessionId,
    ),
  ],
);
