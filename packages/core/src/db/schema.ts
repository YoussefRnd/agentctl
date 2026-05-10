import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import type { SessionStatus, ACPEvent } from '@agentctl/shared';

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  path: text('path').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  branch: text('branch').notNull(),
  worktreePath: text('worktree_path').notNull(),
  agent: text('agent').notNull(),
  agentSessionId: text('agent_session_id'),
  status: text('status').$type<SessionStatus>().notNull().default('idle'),
  totalTokens: integer('total_tokens').notNull().default(0),
  contextLimit: integer('context_limit').notNull().default(128000),
  estimatedCost: real('estimated_cost').notNull().default(0.0),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  closedAt: integer('closed_at', { mode: 'timestamp' }),
});

export const acpEvents = sqliteTable('acp_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  type: text('type').$type<ACPEvent['type']>().notNull(),
  data: text('data').notNull(), // JSON string
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});
