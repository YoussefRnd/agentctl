import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { count as countRows, sql } from 'drizzle-orm';
import { expect, it } from 'vite-plus/test';
import {
  createDatabase,
  projects,
  sessions,
  sessionEvents,
  sessionEventChangeCounts,
  sessionEventChanges,
  sessionOperations,
  sessionTurnAttempts,
} from './index.js';

const migrations = readMigrationFiles({
  migrationsFolder: path.resolve(import.meta.dirname, '../../drizzle'),
});

it('upgrades populated databases from every migration boundary without losing session data', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentctl-migrations-'));
  try {
    // Exercise each historical schema, including the temporarily shipped checks feature.
    for (let count = 0; count <= migrations.length; count++) {
      let hasSavedEffort = false;
      let hasSavedAttempts = false;
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
        if (
          sqlite
            .prepare("SELECT name FROM sqlite_master WHERE name = 'session_event_changes'")
            .get()
        ) {
          const eventId = sqlite.prepare(`SELECT id FROM ${eventsTable} LIMIT 1`).get()!.id;
          for (let i = 0; i < 3; i++)
            sqlite
              .prepare('INSERT INTO session_event_changes (session_id, event_id) VALUES (?, ?)')
              .run('session', eventId);
        }
        if (sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'project_checks'").get()) {
          sqlite.exec(
            "INSERT INTO project_checks (id, project_id, name, command) VALUES ('check', 'project', 'Old check', 'true')",
          );
          sqlite.exec(
            "INSERT INTO check_runs (id, session_id, check_id, name, command, status, started_at) VALUES ('run', 'session', 'check', 'Old check', 'true', 'passed', 1)",
          );
        }
        if (
          sqlite
            .prepare("SELECT name FROM sqlite_master WHERE name = 'session_turn_attempts'")
            .get()
        ) {
          hasSavedAttempts = true;
          sqlite.exec(`
            INSERT INTO session_operations
              (id, session_id, command_id, kind, fingerprint, payload, status)
            VALUES ('operation', 'session', 'command', 'message.send', 'fingerprint', '{}', 'succeeded');
            INSERT INTO session_turn_attempts (id, session_id, operation_id, provider_id, status)
            VALUES ('first-attempt', 'session', 'operation', 'agent', 'interrupted'),
                   ('retry-attempt', 'session', 'operation', 'agent', 'completed');
          `);
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
          contextUsedTokens: null,
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
      if (hasSavedAttempts) {
        expect(db.select().from(sessionOperations).get()).toMatchObject({
          id: 'operation',
          status: 'succeeded',
        });
        expect(db.select().from(sessionTurnAttempts).all()).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: 'first-attempt',
              operationId: 'operation',
              status: 'interrupted',
            }),
            expect.objectContaining({
              id: 'retry-attempt',
              operationId: 'operation',
              status: 'completed',
            }),
          ]),
        );
        expect(db.select().from(sessionTurnAttempts).all()).toHaveLength(2);
      }
      expect(
        db.all<{ name: string; unique: number }>(sql`PRAGMA index_list(session_turn_attempts)`),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'session_turn_attempts_operation', unique: 0 }),
        ]),
      );
      expect(
        db
          .all<{ name: string }>(sql`PRAGMA index_info(session_turn_attempts_operation)`)
          .map((column) => column.name),
      ).toEqual(['operation_id']);
      expect(
        db.all<{ detail: string }>(sql`EXPLAIN QUERY PLAN SELECT * FROM ${sessionTurnAttempts}
          WHERE ${sessionTurnAttempts.operationId} = ${'operation'}`),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            detail: expect.stringContaining('USING INDEX session_turn_attempts_operation'),
          }),
        ]),
      );
      expect(db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
      expect(db.select().from(sessionEventChangeCounts).get()?.retainedCount ?? 0).toBe(
        db.select({ count: countRows() }).from(sessionEventChanges).get()!.count,
      );
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
