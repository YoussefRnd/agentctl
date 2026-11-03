import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { eq } from 'drizzle-orm';
import { DatabaseSync } from 'node:sqlite';
import {
  createDatabase,
  projects,
  sessions,
  sessionEvents,
  sessionEventChanges,
  sessionOperations,
  sessionTurnAttempts,
} from '../../db/index.js';
import { SessionEventRepository } from './session-event-repository.js';
import { SessionOperationStore } from './session-operation-store.js';

function fixture() {
  const db = createDatabase(':memory:');
  db.insert(projects).values({ id: 'p', name: 'Project', path: '/synthetic' }).run();
  db.insert(sessions)
    .values({
      id: 's',
      projectId: 'p',
      branch: 'main',
      worktreePath: '/synthetic',
      taskSlug: 'task',
      baseCommit: 'none',
      agent: 'synthetic',
      selectedProvider: 'synthetic',
    })
    .run();
  const events = new SessionEventRepository(db, { publish() {} });
  return { db, events, store: new SessionOperationStore(db, events) };
}

function message(id: string) {
  return {
    sessionId: 's',
    text: `message ${id}`,
    attachmentIds: [],
    commandId: id,
    fingerprint: id,
    operationId: id,
    attemptId: `attempt-${id}`,
    providerId: 'synthetic',
    attachments: undefined,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('Prepared session writes', () => {
  it('reuses hot statements while rebinding values, nulls and timestamps on each execution', () => {
    const { db, events, store } = fixture();
    vi.useFakeTimers({ toFake: ['Date'] });
    const firstTime = new Date('2030-01-01T00:00:00Z');
    const secondTime = new Date('2030-01-02T00:00:00Z');
    vi.setSystemTime(firstTime);
    db.update(sessions).set({ settledAt: firstTime }).where(eq(sessions.id, 's')).run();
    const first = store.accept({ ...message('first'), traceparent: 'first-trace' });
    expect(db.select().from(sessions).get()?.settledAt).toBeNull();
    store.reconcile('s');
    const prepare = vi.spyOn(DatabaseSync.prototype, 'prepare');
    expect(store.next('s')?.id).toBe('first');
    expect(store.claim('first', 's', 'attempt-first')?.updatedAt).toEqual(firstTime);
    expect(store.next('s')).toBeUndefined();
    vi.setSystemTime(secondTime);
    expect(store.finish('first', 'attempt-first')).toBe('running');
    const second = store.accept(message('second'));
    expect(store.previous('s', 'first')?.eventId).toBe(first.id);
    expect(store.attempt('second')?.id).toBe('attempt-second');
    expect(store.pending('s')).toHaveLength(1);
    store.reconcile('s');
    db.transaction(() => events.updateInTransaction(second.id, { content: 'edited' }));
    expect(prepare).not.toHaveBeenCalled();
    prepare.mockRestore();
    const rows = db.select().from(sessionOperations).all();
    expect(rows.map((row) => [row.id, row.eventId, row.traceparent])).toEqual([
      ['first', first.id, 'first-trace'],
      ['second', second.id, null],
    ]);
    expect(db.select().from(sessionTurnAttempts).all()[0].startedAt).toEqual(firstTime);
    expect(db.select().from(sessions).get()?.updatedAt).toEqual(secondTime);
    expect(JSON.parse(db.select().from(sessionEvents).all()[1].data)).toMatchObject({
      content: 'edited',
    });
  });

  it('rolls back event, change, token, operation and attempt writes if acceptance fails', () => {
    const { db, store } = fixture();
    const settledAt = new Date();
    db.update(sessions).set({ settledAt }).where(eq(sessions.id, 's')).run();
    db.run(
      "CREATE TRIGGER fail_attempt BEFORE INSERT ON session_turn_attempts BEGIN SELECT RAISE(ABORT, 'accept failure'); END",
    );
    expect(() => store.accept(message('first'))).toThrow('accept failure');
    for (const table of [
      sessionEvents,
      sessionEventChanges,
      sessionOperations,
      sessionTurnAttempts,
    ])
      expect(db.select().from(table).all()).toEqual([]);
    expect(db.select().from(sessions).get()?.totalTokens).toBe(0);
    expect(db.select().from(sessions).get()?.settledAt).toEqual(settledAt);
    db.run('DROP TRIGGER fail_attempt');
    expect(store.accept(message('second')).id).toBeGreaterThan(0);
    expect(db.select().from(sessions).get()?.settledAt).toBeNull();
  });

  it('rolls back a claim when starting its attempt fails, and can reuse the statements afterward', () => {
    const { db, store } = fixture();
    store.accept(message('first'));
    db.run(
      "CREATE TRIGGER fail_start BEFORE UPDATE ON session_turn_attempts BEGIN SELECT RAISE(ABORT, 'claim failure'); END",
    );
    expect(() => store.claim('first', 's', 'attempt-first')).toThrow('claim failure');
    expect(db.select().from(sessionOperations).get()?.status).toBe('pending');
    expect(db.select().from(sessionTurnAttempts).get()?.status).toBe('queued');
    db.run('DROP TRIGGER fail_start');
    expect(store.claim('first', 's', 'attempt-first')?.status).toBe('running');
  });

  it('keeps prepared statements on their owning connection, including after rollback', () => {
    const left = fixture();
    const right = fixture();
    left.store.accept(message('left'));
    // Exercise a caller-owned transaction without opening another transaction inside it.
    expect(() =>
      right.db.transaction(() => {
        right.events.insertInTransaction('s', 'text', { content: 'rolled back' });
        throw new Error('rollback');
      }),
    ).toThrow('rollback');
    right.store.accept(message('right'));
    expect(left.db.select().from(sessionOperations).get()?.id).toBe('left');
    expect(right.db.select().from(sessionOperations).get()?.id).toBe('right');
    expect(right.db.select().from(sessionEvents).all()).toHaveLength(1);
  });
});
