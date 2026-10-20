import { expect, it, vi } from 'vite-plus/test';
import { eq } from 'drizzle-orm';
import { createDatabase, projects, sessions, sessionEventChanges } from '@agentctl/core/db';
import { SessionEventRepository } from '@agentctl/core/session';
import { SessionEventQueries } from './session-event-queries.js';

it('preserves gap recovery and subsequent cursor replay at the retention boundary', async () => {
  const db = createDatabase(':memory:');
  const id = '00000000-0000-4000-8000-000000000001';
  db.insert(projects).values({ id: 'p', name: 'Project', path: '/synthetic' }).run();
  db.insert(sessions)
    .values({
      id,
      projectId: 'p',
      branch: 'main',
      worktreePath: '/synthetic',
      taskSlug: 'task',
      baseCommit: 'none',
      agent: 'synthetic',
      selectedProvider: 'synthetic',
    })
    .run();
  const repository = new SessionEventRepository(db, { publish: vi.fn() });
  const first = await repository.append(id, 'text', { role: 'user', content: 'original' });
  db.transaction((tx) => {
    for (let start = 0; start < 9999; start += 100)
      tx.insert(sessionEventChanges)
        .values(
          Array.from({ length: Math.min(100, 9999 - start) }, () => ({
            sessionId: id,
            eventId: first,
          })),
        )
        .run();
  });
  const queries = new SessionEventQueries(db);
  const before = queries.changes(id).snapshot!.changeSequence;
  const next = await repository.append(id, 'text', { role: 'provider', content: 'new' });
  expect(
    db.select().from(sessionEventChanges).where(eq(sessionEventChanges.sessionId, id)).all(),
  ).toHaveLength(10000);
  const gap = queries.changes(id, 0);
  expect(gap.snapshot?.events.map((event) => event.id)).toEqual([first, next]);
  expect(gap.snapshot!.changeSequence).toBeGreaterThan(before);
  const replay = queries.changes(id, before);
  expect(replay.snapshot).toBeUndefined();
  expect(replay.events.map((event) => event.id)).toEqual([next]);
  expect(replay.events[0].sequence).toBe(gap.snapshot!.changeSequence);
  expect(queries.changes(id, gap.snapshot!.changeSequence).events).toEqual([]);
});
