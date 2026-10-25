import { expect, it } from 'vite-plus/test';
import { eq } from 'drizzle-orm';
import { createDatabase, projects, sessions, sessionEvents } from '@agentctl/core/db';
import { decodingRows } from '../../tests/performance/row-decoding-fixture.js';
import { SessionEventCompactReader } from './session-event-compact-reader.js';
import { SessionEventQueries } from './session-event-queries.js';
import { SessionEventPageReader } from './session-event-page-reader.js';
import { prepareEventPageResponse } from './session-event-page-response.js';
import { parseEventRow } from './session-event-row.js';
import { SessionHistoryWorkQueue } from './session-history-work-queue.js';
import { EVENT_HISTORY_BYTE_BUDGET } from './session-event-page-reader.js';

const id = '11111111-1111-4111-8111-111111111111';
function fixture() {
  const db = createDatabase(':memory:');
  db.insert(projects).values({ id: 'p', name: 'Project', path: '/tmp/project' }).run();
  db.insert(sessions)
    .values({
      id,
      projectId: 'p',
      branch: 'main',
      worktreePath: '/tmp/project',
      taskSlug: 'task',
      baseCommit: 'none',
      agent: 'agent',
      selectedProvider: 'agent',
    })
    .run();
  for (const eventId of [1, 3, 7, 9])
    db.insert(sessionEvents)
      .values({
        id: eventId,
        sessionId: id,
        parentEventId: eventId === 1 ? null : 1,
        type: 'text',
        data: JSON.stringify({
          role: eventId === 1 ? 'user' : 'provider',
          content: `quoted " 界 \\ ${eventId}`,
        }),
        metadata: JSON.stringify({ futureField: 'preserved' }),
      })
      .run();
  return db;
}

it('preserves the exact JSON representation of all event variants, metadata and cursor envelopes', async () => {
  const rows = decodingRows(36, true);
  const queue = new SessionHistoryWorkQueue();
  for (const cursors of [{ nextBeforeId: 1 }, { nextBeforeId: null, nextAfterId: 99 }]) {
    const body = await queue.run(
      prepareEventPageResponse(() => ({ rows: rows.slice(), ...cursors })),
    );
    expect(body).toBe(JSON.stringify({ events: rows.map(parseEventRow), ...cursors }));
  }
});

it('yields after bounded row batches and immediately after an individual large event', () => {
  for (const large of [false, true]) {
    const source = decodingRows(20, false);
    if (large)
      source[0] = {
        ...source[0],
        data: JSON.stringify({ role: 'provider', content: 'x'.repeat(20_000) }),
      };
    const visited = new Set<number>();
    const rows = source.map((row, index) => ({
      ...row,
      get data() {
        visited.add(index);
        return row.data;
      },
    }));
    const work = prepareEventPageResponse(() => ({ rows, nextBeforeId: null }));
    expect(work.next().done).toBe(false);
    expect([...visited]).toEqual([]);
    expect(work.next().done).toBe(false);
    expect(visited.size).toBeGreaterThan(0);
    expect(visited.size).toBeLessThanOrEqual(8);
    if (large) expect([...visited]).toEqual([0]);
    work.return(undefined);
  }
});

it('releases encoded rows between slices and consumes its snapshot without changing wire order', async () => {
  const rows = decodingRows(20, false);
  const expected = JSON.stringify({ events: rows.map(parseEventRow), nextBeforeId: 42 });
  const work = prepareEventPageResponse(() => ({ rows, nextBeforeId: 42 }));
  expect(work.next().done).toBe(false);
  expect(rows).toHaveLength(20);
  expect(work.next().done).toBe(false);
  expect(rows).toHaveLength(12);
  expect(work.next().done).toBe(false);
  expect(rows).toHaveLength(4);
  expect(work.next().done).toBe(false);
  expect(rows).toHaveLength(0);
  expect(await new SessionHistoryWorkQueue().run(work)).toBe(expected);
});

it('releases unprocessed rows when a captured response is canceled or fails validation', () => {
  for (const fail of [false, true]) {
    const rows = decodingRows(20, false);
    if (fail) rows[10] = { ...rows[10], metadata: '{' };
    const work = prepareEventPageResponse(() => ({ rows, nextBeforeId: null }));
    expect(work.next().done).toBe(false);
    expect(work.next().done).toBe(false);
    expect(rows).toHaveLength(12);
    if (fail) expect(() => work.next()).toThrow();
    else work.return(undefined);
    expect(rows).toHaveLength(0);
  }
});

it('keeps page, parent and forward-window semantics without reducing requested limits', async () => {
  const queries = new SessionEventQueries(fixture());
  for (const options of [
    { limit: 3 },
    { limit: 2, beforeId: 9 },
    { limit: 200 },
    { limit: 500, beforeId: 1 },
  ])
    expect(await queries.pageResponse(id, options)).toBe(JSON.stringify(queries.page(id, options)));
  for (const options of [
    { limit: 2, aroundId: 3 },
    { limit: 2, afterId: 3 },
    { limit: 500, afterId: 9 },
  ])
    expect(await queries.pageResponse(id, options)).toBe(
      JSON.stringify(queries.window(id, options)),
    );
  expect(await queries.pageResponse(id, { limit: 200, aroundId: 5 })).toBeUndefined();
});

it('captures rows and cursors before yielding and reads fresh state on the next request', async () => {
  const db = fixture();
  const reader = new SessionEventPageReader(db);
  const expected = JSON.stringify(reader.read(id, { limit: 2 }));
  const work = prepareEventPageResponse(() => reader.capture(id, { limit: 2 }));
  expect(work.next().done).toBe(false);
  db.update(sessionEvents)
    .set({ data: JSON.stringify({ role: 'provider', content: 'updated' }) })
    .where(eq(sessionEvents.id, 9))
    .run();
  db.delete(sessionEvents).where(eq(sessionEvents.id, 7)).run();
  const queue = new SessionHistoryWorkQueue();
  expect(await queue.run(work)).toBe(expected);
  const next = await new SessionEventQueries(db).pageResponse(id, { limit: 2 });
  expect(next).toContain('updated');
  expect(JSON.parse(next!).events.map((row: { id: number }) => row.id)).toEqual([1, 3, 9]);
});

it('rejects corrupt rows without returning a partial encoded response or blocking healthy work', async () => {
  const db = fixture();
  db.update(sessionEvents).set({ metadata: '{' }).where(eq(sessionEvents.id, 9)).run();
  const queries = new SessionEventQueries(db);
  await expect(queries.pageResponse(id, { limit: 200 })).rejects.toThrow();
  expect(await queries.pageResponse(id, { limit: 2, beforeId: 9 })).toBe(
    JSON.stringify(queries.page(id, { limit: 2, beforeId: 9 })),
  );
});

it('preserves UTF-8 byte limits and a complete oversized event without losing cursor progress', async () => {
  const db = fixture();
  const queries = new SessionEventQueries(db);
  for (const content of ['界'.repeat(180_000), 'x'.repeat(EVENT_HISTORY_BYTE_BUDGET + 1)]) {
    db.update(sessionEvents)
      .set({ data: JSON.stringify({ role: 'provider', content }) })
      .where(eq(sessionEvents.id, 9))
      .run();
    expect(await queries.pageResponse(id, { limit: 200 })).toBe(
      JSON.stringify(queries.page(id, { limit: 200 })),
    );
  }
});

it('yields after large original payloads even when their compact representations are small', () => {
  const rows = decodingRows(20, false).map((row) => ({
    ...row,
    type: 'tool_call' as const,
    data: JSON.stringify({
      name: 'read',
      kind: 'read',
      status: 'completed',
      rawOutput: 'x'.repeat(20000),
    }),
  }));
  const work = prepareEventPageResponse(() => ({ rows, nextBeforeId: null }), true);
  expect(work.next().done).toBe(false);
  expect(work.next().done).toBe(false);
  expect(rows).toHaveLength(19);
  work.return(undefined);
  expect(rows).toHaveLength(0);
});

it('keeps cached pages and detail revisions fresh after output updates and rejects later corruption', async () => {
  const db = fixture();
  const toolData = (body: string) =>
    JSON.stringify({ name: 'read', kind: 'read', status: 'completed', rawOutput: body });
  db.update(sessionEvents)
    .set({ type: 'tool_call', data: toolData('a'.repeat(20000)) })
    .where(eq(sessionEvents.id, 9))
    .run();
  const queries = new SessionEventQueries(db);
  const options = { limit: 200, compact: true };
  const first = await queries.pageResponse(id, options);
  expect(await queries.pageResponse(id, options)).toBe(first);
  const marker = JSON.parse(first!).events.find((e: { id: number }) => e.id === 9).details.revision;
  expect(JSON.parse((await queries.detailResponse(id, 9))!).revision).toBe(marker);
  db.update(sessionEvents)
    .set({ data: toolData('b'.repeat(20000)) })
    .where(eq(sessionEvents.id, 9))
    .run();
  const second = await queries.pageResponse(id, options);
  expect(second).not.toBe(first);
  const detail = JSON.parse((await queries.detailResponse(id, 9))!);
  expect(detail.revision).toBe(
    JSON.parse(second!).events.find((e: { id: number }) => e.id === 9).details.revision,
  );
  expect(detail.event.data.rawOutput).toBe('b'.repeat(20000));
  db.update(sessionEvents).set({ metadata: 'null' }).where(eq(sessionEvents.id, 9)).run();
  await expect(queries.pageResponse(id, options)).rejects.toThrow();
});

it('keeps original-payload yield accounting on compact cache hits', () => {
  const reader = new SessionEventCompactReader();
  const source = decodingRows(20, false).map((row) => ({
    ...row,
    type: 'tool_call' as const,
    data: JSON.stringify({ name: 'read', status: 'completed', rawOutput: 'x'.repeat(20000) }),
  }));
  source.forEach(reader.encode);
  const rows = source.slice();
  const work = prepareEventPageResponse(() => ({ rows, nextBeforeId: null }), true, reader.encode);
  expect(work.next().done).toBe(false);
  expect(work.next().done).toBe(false);
  expect(rows).toHaveLength(19);
  work.return(undefined);
  expect(rows).toHaveLength(0);
});
