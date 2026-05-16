import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import type { SessionStatus, ACPEvent } from '@agentctl/shared';

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

// acp_events is append-only - only needs createdAt with DB-level default
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
  agent: text('agent').notNull(),
  agentSessionId: text('agent_session_id'),
  selectedDriver: text('selected_driver').notNull().default('claude-code'),
  selectedModel: text('selected_model').notNull().default('sonnet-4'),
  selectedThinkingEffort: text('selected_thinking_effort').notNull().default('medium'),
  status: text('status').$type<SessionStatus>().notNull().default('idle'),
  totalTokens: integer('total_tokens').notNull().default(0),
  contextLimit: integer('context_limit').notNull().default(128000),
  estimatedCost: real('estimated_cost').notNull().default(0.0),
  lastHeartbeat: integer('last_heartbeat', { mode: 'timestamp' }),
  closedAt: integer('closed_at', { mode: 'timestamp' }),
  ...timestamps,
});

export const acpEvents = sqliteTable('acp_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  type: text('type').$type<ACPEvent['type']>().notNull(),
  data: text('data').notNull(), // JSON string
  ...eventTimestamps,
});
