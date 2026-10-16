import path from 'node:path';
import os from 'node:os';
import { loadWorkspaceEnv } from '../config/workspace.js';
import { createDatabase, type CoreDatabase } from './database.js';

export function getDbPath(): string {
  const workspaceRoot = loadWorkspaceEnv();
  if (process.env.NODE_ENV === 'test' || process.env.VITEST === 'true') {
    return process.env.TEST_DATABASE_URL ?? ':memory:';
  }
  const envPath = process.env.DATABASE_URL;
  if (envPath) {
    if (envPath === ':memory:') {
      return envPath;
    }
    return path.resolve(workspaceRoot, envPath);
  }
  return path.join(os.homedir(), '.agentctl', 'agentctl.db');
}

let defaultDatabase: CoreDatabase | undefined;

/** Called by application startup; importing database contracts does not open SQLite. */
export function getDefaultDatabase(): CoreDatabase {
  return (defaultDatabase ??= createDatabase(getDbPath()));
}
