import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asc, eq, sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vite-plus/test';
import {
  createDatabase,
  projects,
  sessions,
  sessionEvents,
  sessionEventChanges,
  sessionEventChangeCounts,
  type DbClient,
} from '../../db/index.js';
import { SessionEventRepository, SESSION_CHANGE_RETENTION } from './session-event-repository.js';

function fixture(database = ':memory:') {
  const db = createDatabase(database);
  db.insert(projects).values({ id: 'p', name: 'Project', path: '/synthetic' }).run();
  db.insert(sessions)
    .values(
      ['a', 'b'].map((id) => ({
        id,
        projectId: 'p',
        branch: 'main',
        worktreePath: '/synthetic',
        taskSlug: id,
        baseCommit: 'none',
        agent: 'synthetic',
        selectedProvider: 'synthetic',
      })),
    )
    .run();
  const bus = { publish: vi.fn() };
  return { db, bus, repository: new SessionEventRepository(db, bus) };
}

function sequences(db: DbClient, sessionId: string) {
  return db
    .select({ sequence: sessionEventChanges.sequence })
    .from(sessionEventChanges)
    .where(eq(sessionEventChanges.sessionId, sessionId))
    .orderBy(asc(sessionEventChanges.sequence))
    .all()
    .map((row) => row.sequence);
}
const retainedCount = (db: DbClient, sessionId: string) =>
  db
    .select()
    .from(sessionEventChangeCounts)
    .where(eq(sessionEventChangeCounts.sessionId, sessionId))
    .get()?.retainedCount ?? 0;

function seed(db: DbClient, count: number, interleaved = false) {
  db.transaction((tx) => {
    for (let start = 0; start < count; start += 100) {
      const values = Array.from({ length: Math.min(100, count - start) }, () => ({
        sessionId: 'a',
        eventId: 1,
      }));
      if (interleaved) values.push(...values.map(() => ({ sessionId: 'b', eventId: 2 })));
      tx.insert(sessionEventChanges).values(values).run();
    }
  });
}

describe('session change retention', () => {
  it('keeps exactly the newest 10000 entries per session across interleaved global sequences', async () => {
    const { db, repository } = fixture();
    seed(db, SESSION_CHANGE_RETENTION - 1, true);
    const other = sequences(db, 'b');
    const original = sequences(db, 'a');
    await repository.append('a', 'text', { content: 'at the limit' });
    expect(sequences(db, 'a').slice(0, -1)).toEqual(original);
    expect(retainedCount(db, 'a')).toBe(SESSION_CHANGE_RETENTION);
    await repository.append('a', 'text', { content: 'overflow' });
    const kept = sequences(db, 'a');
    expect(kept).toHaveLength(SESSION_CHANGE_RETENTION);
    expect(kept.slice(0, -2)).toEqual(original.slice(1));
    expect(sequences(db, 'b')).toEqual(other);
    expect(retainedCount(db, 'a')).toBe(kept.length);
    expect(retainedCount(db, 'b')).toBe(other.length);
  });

  it('handles oversized existing journals and independent deletes without over-pruning', async () => {
    const { db, repository } = fixture();
    seed(db, SESSION_CHANGE_RETENTION + 25);
    const original = sequences(db, 'a');
    await repository.append('a', 'text', { content: 'normalize' });
    expect(sequences(db, 'a').slice(0, -1)).toEqual(original.slice(26));
    db.delete(sessionEventChanges).where(eq(sessionEventChanges.sessionId, 'a')).run();
    expect(retainedCount(db, 'a')).toBe(0);
    await repository.append('a', 'text', { content: 'after clear' });
    expect(sequences(db, 'a')).toHaveLength(1);
    expect(retainedCount(db, 'a')).toBe(1);
  });

  it('rolls back counters, pruned entries, event writes and token updates together', async () => {
    const { db, bus, repository } = fixture();
    seed(db, SESSION_CHANGE_RETENTION);
    const before = sequences(db, 'a');
    expect(() =>
      db.transaction(() => {
        repository.insertInTransaction('a', 'text', { content: 'rolled back' }, null, {
          completionTokens: 9,
        });
        expect(retainedCount(db, 'a')).toBe(SESSION_CHANGE_RETENTION);
        expect(sequences(db, 'a')[0]).not.toBe(before[0]);
        throw new Error('rollback');
      }),
    ).toThrow('rollback');
    expect(sequences(db, 'a')).toEqual(before);
    expect(retainedCount(db, 'a')).toBe(before.length);
    expect(db.select().from(sessionEvents).all()).toEqual([]);
    expect(db.select().from(sessions).where(eq(sessions.id, 'a')).get()?.totalTokens).toBe(0);
    expect(bus.publish).not.toHaveBeenCalled();
    await repository.append('a', 'text', { content: 'committed' });
    expect(sequences(db, 'a').slice(0, -1)).toEqual(before.slice(1));
    expect(retainedCount(db, 'a')).toBe(SESSION_CHANGE_RETENTION);
  });

  it('rolls back the append when pruning fails, including trigger-maintained counts', async () => {
    const { db, bus, repository } = fixture();
    seed(db, SESSION_CHANGE_RETENTION);
    const before = sequences(db, 'a');
    db.run(sql`CREATE TRIGGER reject_retention BEFORE DELETE ON session_event_changes
      BEGIN SELECT RAISE(ABORT, 'pruning failed'); END`);
    await expect(repository.append('a', 'text', { content: 'failed' })).rejects.toThrow(
      'pruning failed',
    );
    expect(sequences(db, 'a')).toEqual(before);
    expect(retainedCount(db, 'a')).toBe(before.length);
    expect(db.select().from(sessionEvents).all()).toEqual([]);
    expect(bus.publish).not.toHaveBeenCalled();
  });

  it('restores counts and pruned entries across nested savepoint rollback', () => {
    const { db, repository } = fixture();
    seed(db, SESSION_CHANGE_RETENTION);
    const original = sequences(db, 'a');
    db.transaction((tx) => {
      repository.insertInTransaction('a', 'text', { content: 'outer first' });
      expect(() =>
        tx.transaction(() => {
          repository.insertInTransaction('a', 'text', { content: 'inner rolled back' });
          throw new Error('savepoint');
        }),
      ).toThrow('savepoint');
      repository.insertInTransaction('a', 'text', { content: 'outer last' });
    });
    expect(sequences(db, 'a').slice(0, -2)).toEqual(original.slice(2));
    expect(retainedCount(db, 'a')).toBe(SESSION_CHANGE_RETENTION);
    expect(
      db
        .select()
        .from(sessionEvents)
        .all()
        .map((row) => JSON.parse(row.data).content),
    ).toEqual(['outer first', 'outer last']);
  });

  it('shares committed counts between connections and repository instances, without cached state', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'agentctl-retention-'));
    try {
      const file = join(directory, 'journal.db');
      const { db, repository } = fixture(file);
      seed(db, SESSION_CHANGE_RETENTION);
      const otherDb = createDatabase(file);
      const other = new SessionEventRepository(otherDb, { publish: vi.fn() });
      const original = sequences(db, 'a');
      await repository.append('a', 'text', { content: 'first connection' });
      await other.append('a', 'text', { content: 'second connection' });
      await repository.append('a', 'text', { content: 'first again' });
      const reopened = createDatabase(file);
      expect(sequences(reopened, 'a').slice(0, -3)).toEqual(original.slice(3));
      for (const connection of [db, otherDb, reopened])
        expect(retainedCount(connection, 'a')).toBe(SESSION_CHANGE_RETENTION);
      db.delete(sessions).where(eq(sessions.id, 'a')).run();
      expect(sequences(otherDb, 'a')).toEqual([]);
      expect(otherDb.select().from(sessionEventChangeCounts).all()).toEqual([]);
      expect(reopened.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
