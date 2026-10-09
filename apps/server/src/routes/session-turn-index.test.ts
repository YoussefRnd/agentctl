import {
  createDatabase,
  projects,
  sessions,
  sessionEvents,
  sessionEventChanges,
} from '@agentctl/core/db';
import { expect, it, vi } from 'vitest';
import { eq, gte } from 'drizzle-orm';
import { readTurnIndex } from './session-turn-index.js';

it('keeps previews with their owning queued input and returns captured change counts', () => {
  const db = createDatabase(':memory:');
  db.insert(projects).values({ id: 'p', name: 'Project', path: '/tmp/project' }).run();
  db.insert(sessions)
    .values({
      id: 's',
      projectId: 'p',
      branch: 'main',
      worktreePath: '/tmp/project',
      taskSlug: 's',
      baseCommit: 'none',
      agent: 'agent',
      selectedProvider: 'agent',
    })
    .run();
  const add = (
    id: number,
    type: typeof sessionEvents.$inferInsert.type,
    data: Record<string, unknown>,
    parentEventId?: number,
    attemptId?: string,
  ) =>
    db
      .insert(sessionEvents)
      .values({
        id,
        sessionId: 's',
        type,
        data: JSON.stringify(data),
        parentEventId,
        metadata: attemptId ? JSON.stringify({ attemptId }) : undefined,
      })
      .run();
  add(1, 'text', { role: 'user', content: 'First prompt' }, undefined, 'first');
  add(2, 'text', { role: 'user', content: 'Queued prompt' }, undefined, 'second');
  add(3, 'tool_call', { title: 'Write file', rawOutput: 'large tool payload '.repeat(10000) }, 1);
  add(4, 'text', { role: 'provider', content: 'First answer.\n\nDetailed body.' }, 3);
  add(
    5,
    'status',
    {
      status: 'turn_end',
      turnChanges: { totalAdditions: 7, totalDeletions: 2, files: [{ path: 'file.ts' }] },
    },
    undefined,
    'first',
  );
  add(
    6,
    'plan_update',
    { plan: [{ name: '' }, { text: 'Plan for queued prompt' }] },
    undefined,
    'second',
  );
  const index = readTurnIndex(db, 's');
  expect(index.map((turn) => [turn.prompt, turn.summary])).toEqual([
    ['First prompt', 'First answer.'],
    ['Queued prompt', 'Plan for queued prompt'],
  ]);
  expect(index[0].diffStats).toEqual({ additions: 7, deletions: 2, filesCount: 1 });
  expect(JSON.stringify(index)).not.toContain('large tool payload');
  const selects = vi.spyOn(db, 'select');
  expect(readTurnIndex(db, 's')).toBe(index);
  expect(selects.mock.calls.some(([fields]) => fields && 'content' in fields)).toBe(false);
  selects.mockRestore();
  db.update(sessionEvents)
    .set({ data: JSON.stringify({ role: 'provider', content: 'Updated first answer.' }) })
    .where(eq(sessionEvents.id, 4))
    .run();
  db.insert(sessionEventChanges).values({ sessionId: 's', eventId: 4 }).run();
  expect(readTurnIndex(db, 's')[0].summary).toBe('Updated first answer.');
  db.delete(sessionEvents).where(gte(sessionEvents.id, 2)).run();
  expect(readTurnIndex(db, 's').map((turn) => turn.eventId)).toEqual([1]);
  add(
    7,
    'text',
    { role: 'user', content: 'Still waiting', deliveryStatus: 'queued' },
    undefined,
    'waiting',
  );
  add(8, 'text', { role: 'user', content: 'Removed', deliveryStatus: 'cancelled' });
  expect(readTurnIndex(db, 's').map((turn) => turn.eventId)).toEqual([1]);
  db.update(sessionEvents)
    .set({
      data: JSON.stringify({ role: 'user', content: 'Still waiting', deliveryStatus: 'accepted' }),
    })
    .where(eq(sessionEvents.id, 7))
    .run();
  db.insert(sessionEventChanges).values({ sessionId: 's', eventId: 7 }).run();
  expect(readTurnIndex(db, 's').map((turn) => turn.eventId)).toEqual([1, 7]);
});
