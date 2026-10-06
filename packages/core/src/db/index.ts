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
import { loadWorkspaceEnv } from '../config/workspace.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const workspaceRoot = loadWorkspaceEnv();

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
  // SQLite ignores foreign_keys changes inside a transaction. Drizzle wraps
  // migrations in one, so disable enforcement before any table rebuilds.
  sqlite.exec('PRAGMA foreign_keys = OFF;');

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
      const wrap =
        (behavior: 'DEFERRED' | 'IMMEDIATE' | 'EXCLUSIVE') =>
        (...args: any[]) => {
          sqlite.exec(`BEGIN ${behavior} TRANSACTION;`);
          try {
            const result = fn(...args);
            if (result && typeof result.then === 'function')
              throw new Error('SQLite transactions require a synchronous callback');
            sqlite.exec('COMMIT;');
            return result;
          } catch (err) {
            sqlite.exec('ROLLBACK;');
            throw err;
          }
        };
      const deferred = wrap('DEFERRED');
      return Object.assign(deferred, {
        deferred,
        immediate: wrap('IMMEDIATE'),
        exclusive: wrap('EXCLUSIVE'),
      });
    },
  };

  const db = drizzle(adapted as any, { schema });
  /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */

  try {
    migrate(db, { migrationsFolder: path.join(__dirname, '../../drizzle') });
    const violations = sqlite.prepare('PRAGMA foreign_key_check').all();
    if (violations.length > 0) {
      throw new Error(`Database migration left ${violations.length} foreign key violations`);
    }
    sqlite.exec('PRAGMA foreign_keys = ON;');
  } catch (error) {
    sqlite.close();
    throw error;
  }

  return db;
}

export function getDbPath(): string {
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

export const db: CoreDatabase = createDatabase(getDbPath());
