import { SessionEventRepository } from '@agentctl/core/session';
import { beforeEach, expect, it } from 'vitest';
import { createDatabase, projects, sessions, sessionEvents } from '@agentctl/core/db';
import {
  EVENT_HISTORY_BYTE_BUDGET,
  EVENT_REPLAY_LIMIT,
  readEventPage,
  readEventReplay,
  readSessionChangeCatchUp,
} from '../services/session-event-history.js';

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
