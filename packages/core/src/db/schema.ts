import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import type { SessionStatus, ACPEvent } from '@agentctl/shared';

// Use this helper for all schemas
const timestamps = {
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()).$onUpdateFn(() => new Date()).notNull(),
};

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  path: text('path').notNull(),
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
  baseCommit: text('base_commit').notNull(),
  agent: text('agent').notNull(),
  agentSessionId: text('agent_session_id'),
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
  ...timestamps,
});
