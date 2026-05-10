import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from './schema.js';

const sqlite = new Database('agentctl.db');
sqlite.pragma('journal_mode = WAL');

// Ensure tables are created (simple for prototype, would use migrations in production)
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    branch TEXT NOT NULL,
    worktree_path TEXT NOT NULL,
    agent TEXT NOT NULL,
    agent_session_id TEXT,
    status TEXT NOT NULL DEFAULT 'idle',
    total_tokens INTEGER NOT NULL DEFAULT 0,
    context_limit INTEGER NOT NULL DEFAULT 128000,
    estimated_cost REAL NOT NULL DEFAULT 0.0,
    created_at INTEGER NOT NULL,
    closed_at INTEGER,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS acp_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    type TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );
`);

export const db = drizzle(sqlite, { schema });
