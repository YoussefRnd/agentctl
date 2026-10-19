import { SessionEventRepository } from '@agentctl/core/session';
import { beforeEach, expect, it, vi } from 'vite-plus/test';
import { DatabaseSync } from 'node:sqlite';
import { eq } from 'drizzle-orm';
import { createDatabase, projects, sessions, sessionEvents } from '@agentctl/core/db';
import {
  EVENT_HISTORY_BYTE_BUDGET,
  EVENT_REPLAY_LIMIT,
  readEventPage,
  readEventReplay,
  readSessionChangeCatchUp,
} from '../services/session-event-history.js';
import { SessionEventQueries } from '../services/session-event-queries.js';

const id = '11111111-1111-4111-8111-111111111111';
let db: ReturnType<typeof createDatabase>;
beforeEach(() => {
  db = createDatabase(':memory:');
  db.insert(projects).values({ id: 'project', name: 'Project', path: '/tmp/project' }).run();
  db.insert(sessions)
    .values({
      id,
      projectId: 'project',
      branch: 'main',
      worktreePath: '/tmp/project',
      taskSlug: 'task',
      baseCommit: 'none',
      agent: 'agent',
      selectedProvider: 'agent',
    })
    .run();
});
function insert(eventId: number, content: string) {
  db.insert(sessionEvents)
    .values({
      id: eventId,
      sessionId: id,
      type: 'text',
      data: JSON.stringify({ content, role: 'provider' }),
    })
    .run();
}

it('bounds replay by count, bytes and the captured high-water mark', async () => {
  for (let eventId = 1; eventId <= EVENT_REPLAY_LIMIT + 1; eventId++)
    insert(eventId, String(eventId));
  expect(await readEventReplay(db, id, 0, EVENT_REPLAY_LIMIT + 1)).toBeNull();
  expect(
    (await readEventReplay(db, id, EVENT_REPLAY_LIMIT - 1, EVENT_REPLAY_LIMIT))?.map(
      (row) => row.id,
    ),
  ).toEqual([EVENT_REPLAY_LIMIT]);
  expect(await readEventReplay(db, id, 999, EVENT_REPLAY_LIMIT)).toBeNull();
  expect(await readEventReplay(db, id, EVENT_REPLAY_LIMIT, EVENT_REPLAY_LIMIT)).toEqual([]);
  insert(1000, '界'.repeat(EVENT_HISTORY_BYTE_BUDGET / 2));
  expect(await readEventReplay(db, id, 999, 1000)).toBeNull();
});

it('decides against oversized replay before decoding its payload', async () => {
  db.insert(sessionEvents)
    .values({ id: 1, sessionId: id, type: 'text', data: 'x'.repeat(EVENT_HISTORY_BYTE_BUDGET + 1) })
    .run();
  expect(await readEventReplay(db, id, 0, 1)).toBeNull();
});

it('pages by UTF-8 bytes without truncating large messages or losing cursor progress', async () => {
  const content = '界'.repeat(150_000);
  for (let eventId = 1; eventId <= 4; eventId++) insert(eventId, content);
  const page = await readEventPage(db, id, { limit: 200 });
  expect(page.events.map((row) => row.id)).toEqual([3, 4]);
  expect(page.nextBeforeId).toBe(3);
  expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(EVENT_HISTORY_BYTE_BUDGET);
  const earlier = await readEventPage(db, id, { limit: 200, beforeId: page.nextBeforeId! });
  expect(earlier.events.map((row) => row.id)).toEqual([1, 2]);
  expect(earlier.nextBeforeId).toBeNull();
  const huge = 'a'.repeat(EVENT_HISTORY_BYTE_BUDGET + 1);
  insert(5, huge);
  const oversized = await readEventPage(db, id, { limit: 200 });
  expect(oversized.events).toHaveLength(1);
  expect(oversized.events[0].data).toMatchObject({ content: huge });
  expect(oversized.nextBeforeId).toBe(5);
  expect(
    (await readEventPage(db, id, { limit: 200, throughId: 2 })).events.map((row) => row.id),
  ).toEqual([1, 2]);
});

it('replays changes to old rows using an immutable cursor and snapshots after deletions', async () => {
  const repository = new SessionEventRepository(db, { publish() {} });
  const old = await repository.append(id, 'text', { role: 'provider', content: 'old' });
  await repository.append(id, 'text', { role: 'provider', content: 'newer' });
  const snapshot = readSessionChangeCatchUp(db, id).snapshot!;
  await repository.updateSilently(old, { content: 'corrected' });
  const replay = readSessionChangeCatchUp(db, id, snapshot.changeSequence);
  expect(replay.snapshot).toBeUndefined();
  expect(replay.events).toHaveLength(1);
  expect(replay.events[0]).toMatchObject({ id: old, data: { content: 'corrected' } });
  expect(replay.events[0].sequence).toBeGreaterThan(snapshot.changeSequence);
  const cursor = replay.events[0].sequence!;
  await repository.deleteEventsAfter(id, old);
  expect(readSessionChangeCatchUp(db, id, cursor).snapshot).toMatchObject({
    events: [],
    highWaterId: 0,
  });
});

it('reuses bounded statement shapes across cursor values and limits without caching pages', () => {
  for (let eventId = 1; eventId <= 8; eventId++) insert(eventId, String(eventId));
  const queries = new SessionEventQueries(db);
  const prepare = vi.spyOn(DatabaseSync.prototype, 'prepare');
  try {
    for (let limit = 1; limit <= 5; limit++) {
      expect(queries.page(id, { limit }).events).toHaveLength(limit);
      queries.page(id, { limit, beforeId: 8 - limit });
      queries.page(id, { limit, throughId: 8 - limit });
      queries.page(id, { limit, beforeId: 7, throughId: 8 - limit });
    }
    // Four candidate shapes and one payload query, independent of IDs and page length.
    expect(prepare).toHaveBeenCalledTimes(5);
    prepare.mockClear();
    expect(queries.page(id, { limit: 2 }).events.map((row) => row.id)).toEqual([7, 8]);
    expect(prepare).not.toHaveBeenCalled();
  } finally {
    prepare.mockRestore();
  }
  db.update(sessionEvents)
    .set({ data: JSON.stringify({ role: 'provider', content: 'updated' }) })
    .where(eq(sessionEvents.id, 8))
    .run();
  expect(queries.page(id, { limit: 1 }).events[0].data).toMatchObject({ content: 'updated' });
  db.delete(sessionEvents).where(eq(sessionEvents.id, 8)).run();
  expect(queries.page(id, { limit: 1 }).events[0].id).toBe(7);
});

it('keeps exact sparse selections and parent anchors scoped to their session and high-water mark', () => {
  const other = '22222222-2222-4222-8222-222222222222';
  db.insert(sessions)
    .values({
      id: other,
      projectId: 'project',
      branch: 'main',
      worktreePath: '/tmp/other',
      taskSlug: 'other',
      baseCommit: 'none',
      agent: 'agent',
      selectedProvider: 'agent',
    })
    .run();
  for (const eventId of [1, 3, 7, 9]) insert(eventId, String(eventId));
  db.insert(sessionEvents)
    .values({ id: 5, sessionId: other, type: 'text', data: 'invalid other-session JSON' })
    .run();
  db.update(sessionEvents).set({ parentEventId: 5 }).where(eq(sessionEvents.id, 3)).run();
  const queries = new SessionEventQueries(db);
  const page = queries.page(id, { limit: 2, throughId: 7, beforeId: 9 });
  expect(page.events.map((row) => row.id)).toEqual([3, 7]);
  expect(page.nextBeforeId).toBe(3);
  expect(queries.page(id, { limit: 2, beforeId: 3 }).events.map((row) => row.id)).toEqual([1]);
  expect(queries.page(id, { limit: 2, throughId: 0 }).events).toEqual([]);
  expect(queries.page(id, { limit: 2, beforeId: 1 })).toEqual({ events: [], nextBeforeId: null });
});

it('skips an oversized parent before decoding it and preserves extended metadata', () => {
  db.insert(sessionEvents)
    .values({ id: 1, sessionId: id, type: 'text', data: 'x'.repeat(EVENT_HISTORY_BYTE_BUDGET) })
    .run();
  db.insert(sessionEvents)
    .values({
      id: 2,
      sessionId: id,
      parentEventId: 1,
      type: 'text',
      data: JSON.stringify({ role: 'provider', content: 'small response' }),
      metadata: JSON.stringify({ attemptId: 'attempt', futureField: 'preserved' }),
    })
    .run();
  const page = new SessionEventQueries(db).page(id, { limit: 1 });
  expect(page.events.map((row) => row.id)).toEqual([2]);
  expect(page.events[0].metadata).toMatchObject({ attemptId: 'attempt', futureField: 'preserved' });
  expect(page.nextBeforeId).toBe(2);
});

it.each([
  { data: '{', metadata: null },
  { data: JSON.stringify({ role: 'provider', content: 123 }), metadata: null },
  { data: JSON.stringify({ role: 'provider', content: 'valid' }), metadata: '{' },
  { data: JSON.stringify({ role: 'provider', content: 'valid' }), metadata: 'null' },
])(
  'rejects corrupt persisted payloads or metadata instead of bypassing validation: %j',
  (values) => {
    db.insert(sessionEvents)
      .values({ id: 1, sessionId: id, type: 'text', ...values })
      .run();
    expect(() => new SessionEventQueries(db).page(id, { limit: 1 })).toThrow();
  },
);

it('does not share prepared queries or rows across database connections', () => {
  insert(1, 'first database');
  const second = createDatabase(':memory:');
  second.insert(projects).values({ id: 'project', name: 'Other', path: '/tmp/other' }).run();
  second
    .insert(sessions)
    .values({
      id,
      projectId: 'project',
      branch: 'main',
      worktreePath: '/tmp/other',
      taskSlug: 'other',
      baseCommit: 'none',
      agent: 'agent',
      selectedProvider: 'agent',
    })
    .run();
  second
    .insert(sessionEvents)
    .values({
      id: 1,
      sessionId: id,
      type: 'text',
      data: JSON.stringify({ role: 'provider', content: 'second database' }),
    })
    .run();
  expect(new SessionEventQueries(db).page(id, { limit: 1 }).events[0].data).toMatchObject({
    content: 'first database',
  });
  expect(new SessionEventQueries(second).page(id, { limit: 1 }).events[0].data).toMatchObject({
    content: 'second database',
  });
});
