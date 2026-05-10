import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import Database from 'better-sqlite3';
import * as schema from './schema.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createDatabase(dbPath: string) {
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON'); // Critical for cascading deletes

  const db = drizzle(sqlite, { schema });

  // Run migrations automatically for the prototype
  migrate(db, { migrationsFolder: path.join(__dirname, '../../drizzle') });

  return db;
}

export const db = createDatabase('agentctl.db');
