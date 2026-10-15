import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { sql } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { createDatabase, projects, sessions, sessionEvents } from './index.js';

const migrations = readMigrationFiles({
  migrationsFolder: path.resolve(import.meta.dirname, '../../drizzle'),
});

it('upgrades populated databases from every migration boundary without losing session data', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentctl-migrations-'));
  try {
    // Exercise each historical schema, including the temporarily shipped checks feature.
    for (let count = 0; count <= migrations.length; count++) {
      let hasSavedEffort = false;
      const databasePath = path.join(directory, `${count}.db`);
      const sqlite = new DatabaseSync(databasePath);
      sqlite.exec('PRAGMA foreign_keys = OFF;');
      sqlite.exec(
        'CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash TEXT NOT NULL, created_at NUMERIC)',
      );
      for (const migration of migrations.slice(0, count)) {
        for (const statement of migration.sql) sqlite.exec(statement);
        sqlite
          .prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')
          .run(migration.hash, migration.folderMillis);
      }
      if (count > 0) {
        sqlite.exec(
          "INSERT INTO projects (id, name, path) VALUES ('project', 'Existing project', '/tmp/project')",
        );
        const columns = sqlite
          .prepare('PRAGMA table_info(sessions)')
          .all()
          .map((column) => column.name);
        const values: Record<string, string> = {
          id: 'session',
          project_id: 'project',
          branch: 'main',
          worktree_path: '/tmp/project',
          task_slug: 'existing',
          base_commit: 'none',
          agent: 'agent',
          selected_provider: 'agent',
          selected_thinking_effort: 'vendor-choice',
        };
        hasSavedEffort = columns.includes('selected_thinking_effort');
        const fields = Object.keys(values).filter((field) => columns.includes(field));
        sqlite
          .prepare(
            `INSERT INTO sessions (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`,
          )
          .run(...fields.map((field) => values[field]));
        const eventsTable = sqlite
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('acp_events', 'session_events')",
          )
          .get()!.name;
        sqlite
          .prepare(`INSERT INTO ${eventsTable} (session_id, type, data) VALUES (?, ?, ?)`)
          .run('session', 'text', JSON.stringify({ role: 'user', content: 'Keep my history' }));
        if (sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'project_checks'").get()) {
          sqlite.exec(
            "INSERT INTO project_checks (id, project_id, name, command) VALUES ('check', 'project', 'Old check', 'true')",
          );
          sqlite.exec(
            "INSERT INTO check_runs (id, session_id, check_id, name, command, status, started_at) VALUES ('run', 'session', 'check', 'Old check', 'true', 'passed', 1)",
          );
        }
      }
      sqlite.close();

      const db = createDatabase(databasePath);
      if (count > 0) {
        expect(db.select().from(projects).get()?.name, `migration ${count}`).toBe(
          'Existing project',
        );
        expect(db.select().from(sessions).get()).toMatchObject({
          id: 'session',
          discardBackup: null,
        });
        if (hasSavedEffort)
          expect(db.select().from(sessions).get()?.selectedThinkingEffort).toBe('vendor-choice');
        expect(
          db.select().from(sessionEvents).get(),
          `history after migration ${count}`,
        ).toBeDefined();
        expect(JSON.parse(db.select().from(sessionEvents).get()!.data).content).toBe(
          'Keep my history',
        );
      }
      expect(db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
      expect(
        db
          .all<{ name: string; notnull: number; dflt_value: string | null }>(
            sql`PRAGMA table_info(sessions)`,
          )
          .find((column) => column.name === 'selected_thinking_effort'),
      ).toMatchObject({ notnull: 0, dflt_value: null });
      expect(db.get(sql`PRAGMA foreign_keys`)).toEqual({ foreign_keys: 1 });
      expect(
        db.all(sql`SELECT name FROM sqlite_master WHERE name IN ('project_checks', 'check_runs')`),
      ).toEqual([]);
      expect(db.all(sql`SELECT hash FROM __drizzle_migrations`)).toHaveLength(migrations.length);
      // Starting the app a second time must not rerun ALTER/DROP statements.
      const reopened = createDatabase(databasePath);
      expect(reopened.all(sql`SELECT hash FROM __drizzle_migrations`)).toHaveLength(
        migrations.length,
      );
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}, 30_000);
