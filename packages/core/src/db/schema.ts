import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';
import { relations, sql } from 'drizzle-orm';
import type { SessionStatus, SessionEvent, SessionMode } from '@agentctl/shared';
import {
  DEFAULT_AGENT_MODEL,
  DEFAULT_CONTEXT_LIMIT,
  DEFAULT_THINKING_EFFORT,
} from '../config/runtime-defaults.js';

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

// session_events is append-only - only needs createdAt with DB-level default
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
  agent: text('agent').notNull(),
  agentSessionId: text('agent_session_id'),
  selectedProvider: text('selected_provider').notNull(),
  selectedModel: text('selected_model').notNull().default(DEFAULT_AGENT_MODEL),
  selectedThinkingEffort: text('selected_thinking_effort')
    .notNull()
    .default(DEFAULT_THINKING_EFFORT),
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
  plan: text('plan').notNull().default('[]'),
  sessionConfigOptions: text('session_config_options').notNull().default('[]'),
  sessionMetrics: text('session_metrics').notNull().default('{}'), // JSON string for breakdown, costs, etc.
  agentPersona: text('agent_persona'),
  availableAgentPersonas: text('available_agent_personas').notNull().default('[]'),
  ...timestamps,
});

export const providers = sqliteTable('providers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  installState: text('install_state').notNull().default('not_installed'),
  installError: text('install_error'),
  authState: text('auth_state').notNull().default('unknown'),
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
  customEnv: text('custom_env').notNull().default('{}'), // Store user-configured credentials as a JSON string
  supportsDynamicModel: integer('supports_dynamic_model', { mode: 'boolean' })
    .notNull()
    .default(false),
  supportsDynamicConfig: integer('supports_dynamic_config', { mode: 'boolean' })
    .notNull()
    .default(false),
  supportsLogout: integer('supports_logout', { mode: 'boolean' }).notNull().default(false),
  features: text('features').notNull().default('{}'),
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
    data: text('data').notNull(), // JSON string
    metadata: text('metadata'), // JSON string
    ...eventTimestamps,
  },
  (table) => [index('session_events_session_id_idx').on(table.sessionId)],
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
