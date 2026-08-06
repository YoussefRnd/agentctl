import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import { DatabaseSync } from 'node:sqlite';
import * as schema from './schema.js';
export * from './schema.js';
export * from './zod-schemas.js';
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

const workspaceRoot = findWorkspaceRoot(process.cwd());
const envPath = path.join(workspaceRoot, '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

export type CoreDatabase = BaseSQLiteDatabase<'sync', unknown, typeof schema>;

export type DbClient = CoreDatabase;

export function createDatabase(dbPath: string): CoreDatabase {
  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const sqlite = new DatabaseSync(dbPath);
  sqlite.exec('PRAGMA journal_mode = WAL;');
  sqlite.exec('PRAGMA foreign_keys = ON;');

  /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
  const adapted = {
    prepare(sql: string) {
      const stmt = sqlite.prepare(sql);
      const createWrapped = (isRaw = false) => ({
        raw(mode = true) {
          return createWrapped(mode);
        },
        all(...args: any[]) {
          if (isRaw) stmt.setReturnArrays(true);
          try {
            return stmt.all(...args);
          } finally {
            if (isRaw) stmt.setReturnArrays(false);
          }
        },
        get(...args: any[]) {
          if (isRaw) stmt.setReturnArrays(true);
          try {
            return stmt.get(...args);
          } finally {
            if (isRaw) stmt.setReturnArrays(false);
          }
        },
        run(...args: any[]) {
          return stmt.run(...args);
        },
      });
      return createWrapped(false);
    },
    exec(sql: string) {
      sqlite.exec(sql);
      return adapted;
    },
    pragma(pragmaSql: string) {
      sqlite.exec(`PRAGMA ${pragmaSql};`);
    },
    transaction(fn: (...args: any[]) => any) {
      return (...args: any[]) => {
        sqlite.exec('BEGIN TRANSACTION;');
        try {
          const result = fn(...args);
          sqlite.exec('COMMIT;');
          return result;
        } catch (err) {
          sqlite.exec('ROLLBACK;');
          throw err;
        }
      };
    },
  };

  const db = drizzle(adapted as any, { schema });
  /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */

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

export const db: CoreDatabase = createDatabase(getDbPath());
