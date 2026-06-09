import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import Database from 'better-sqlite3';
import * as schema from './schema.js';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function findWorkspaceRoot(startDir: string): string {
  let current = startDir;
  while (current !== path.parse(current).root) {
    if (
      fs.existsSync(path.join(current, 'pnpm-workspace.yaml')) ||
      fs.existsSync(path.join(current, '.git'))
    ) {
      return current;
    }
    current = path.dirname(current);
  }
  return startDir;
}

// Load env variables as early as possible so that DATABASE_URL is available
const workspaceRoot = findWorkspaceRoot(process.cwd());
const envPath = path.join(workspaceRoot, '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

export function createDatabase(dbPath: string) {
  // Ensure directory exists if it's a file path
  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  const db = drizzle(sqlite, { schema });

  migrate(db, { migrationsFolder: path.join(__dirname, '../../drizzle') });

  return db;
}

export function getDbPath(): string {
  const envPath = process.env.DATABASE_URL;
  if (envPath) {
    if (envPath === ':memory:') {
      return envPath;
    }
    return path.resolve(workspaceRoot, envPath);
  }
  if (process.env.NODE_ENV === 'test') {
    return ':memory:';
  }
  return path.join(os.homedir(), '.agentctl', 'agentctl.db');
}

export const db = createDatabase(getDbPath());
