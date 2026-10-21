import { afterEach, expect, it, vi } from 'vite-plus/test';
import { DatabaseSync } from 'node:sqlite';
import { eq } from 'drizzle-orm';
import {
  createDatabase,
  projects,
  sessions,
  providers,
  sessionTurnAttempts,
} from '../../db/index.js';
import { SessionEventRepository } from './session-event-repository.js';
import { SessionOperationStore } from './session-operation-store.js';
import { SessionTurnStore } from './session-turn-store.js';

function fixture() {
  const db = createDatabase(':memory:');
  db.insert(projects).values({ id: 'p', name: 'Project', path: '/synthetic' }).run();
  for (const id of ['a', 'b'])
    db.insert(sessions)
      .values({
        id,
        projectId: 'p',
        branch: 'main',
        worktreePath: '/synthetic',
        taskSlug: id,
        baseCommit: 'none',
        agent: 'synthetic',
        selectedProvider: id,
      })
      .run();
  const events = new SessionEventRepository(db, { publish() {} });
  const operations = new SessionOperationStore(db, events);
  operations.accept({
    sessionId: 'a',
    text: 'hello',
    attachmentIds: [],
    commandId: 'message',
    fingerprint: 'hash',
    operationId: 'operation',
    attemptId: 'attempt',
    providerId: 'a',
    attachments: undefined,
  });
  operations.claim('operation', 'a', 'attempt');
  return { db, store: new SessionTurnStore(db) };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('rebinds turn values and encoded dates, preserving cancellation and connection ownership', () => {
  const left = fixture(),
    right = fixture();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
  left.store.markDispatched('attempt'); // Warm every fixed shape outside the reuse assertion.
  vi.setSystemTime(new Date('2030-01-02T00:00:00Z'));
  const prepare = vi.spyOn(DatabaseSync.prototype, 'prepare');
  left.store.setSessionStatus('b', 'error');
  left.store.markDispatched('attempt');
  left.store.finishAttempt('attempt', 'cancelled');
  left.store.finishAttempt('attempt', 'completed');
  expect(left.store.session('a')?.selectedProvider).toBe('a');
  expect(left.store.session('b')?.selectedProvider).toBe('b');
  expect(prepare).not.toHaveBeenCalled();
  prepare.mockRestore();
  expect(left.db.select().from(sessionTurnAttempts).get()).toMatchObject({
    status: 'cancelled',
    dispatchedAt: new Date(),
    endedAt: new Date(),
    updatedAt: new Date(),
  });
  expect(left.db.select().from(sessions).where(eq(sessions.id, 'b')).get()).toMatchObject({
    status: 'error',
    updatedAt: new Date(),
  });
  expect(right.db.select().from(sessionTurnAttempts).get()?.status).toBe('running');
  expect(() =>
    left.db.transaction(() => {
      left.store.setSessionStatus('a', 'error');
      throw new Error('rollback');
    }),
  ).toThrow('rollback');
  expect(left.db.select().from(sessions).where(eq(sessions.id, 'a')).get()?.status).toBe('idle');
});

it('reads fresh provider settings and keeps catalog identities, nulls and compactions independent', () => {
  const { db, store } = fixture();
  db.insert(providers)
    .values({ id: 'a', name: 'A', command: 'synthetic', nativelyLoadsSkills: true })
    .run();
  expect(store.providerLoadsSkills('a')).toBe(true);
  db.update(providers).set({ nativelyLoadsSkills: false }).where(eq(providers.id, 'a')).run();
  expect(store.providerLoadsSkills('a')).toBe(false);
  const a = { sessionId: 'a', providerId: 'a', nativeSessionId: 'native' };
  const b = { ...a, sessionId: 'b', providerId: 'b' };
  store.deliverCatalog(a, 'first', null);
  store.compactCatalog(a, 'compaction');
  expect(store.catalog(a)).toEqual({ catalogHash: null, compactionId: 'compaction' });
  store.deliverCatalog(a, 'second', 'older-compaction');
  expect(store.catalog(a)).toEqual({ catalogHash: 'second', compactionId: 'compaction' });
  store.deliverCatalog(b, 'other', null);
  expect(() =>
    db.transaction(() => {
      store.clearCatalog(a);
      throw new Error('rollback');
    }),
  ).toThrow('rollback');
  expect(store.catalog(a)?.catalogHash).toBe('second');
  store.clearCatalog(a);
  expect(store.catalog(a)).toBeUndefined();
  expect(store.catalog(b)).toEqual({ catalogHash: 'other', compactionId: null });
});
