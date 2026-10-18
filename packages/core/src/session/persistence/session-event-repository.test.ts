import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { eq } from 'drizzle-orm';
import {
  createDatabase,
  projects,
  sessions,
  sessionEvents,
  sessionEventChanges,
} from '../../db/index.js';
import { SessionEventRepository } from './session-event-repository.js';

function fixture() {
  const db = createDatabase(':memory:');
  db.insert(projects).values({ id: 'p', name: 'Project', path: '/tmp/project' }).run();
  db.insert(sessions)
    .values({
      id: 's',
      projectId: 'p',
      branch: 'main',
      worktreePath: '/tmp/project',
      taskSlug: 'task',
      baseCommit: 'none',
      agent: 'provider',
      selectedProvider: 'provider',
    })
    .run();
  const bus = { publish: vi.fn() };
  return { db, bus, repository: new SessionEventRepository(db, bus) };
}

describe('SessionEventRepository transactions', () => {
  let context: ReturnType<typeof fixture>;
  beforeEach(() => {
    context = fixture();
  });

  it('publishes notices without creating history rows or advancing the change cursor', () => {
    const { db, bus, repository } = context;
    const notice = {
      type: 'notice' as const,
      sessionId: 's',
      severity: 'error',
      title: 'Optional integration unavailable',
    };
    repository.publishNotice(notice);
    expect(bus.publish).toHaveBeenCalledExactlyOnceWith(notice);
    expect(db.select().from(sessionEvents).all()).toEqual([]);
    expect(db.select().from(sessionEventChanges).all()).toEqual([]);
    expect(db.select().from(sessions).get()?.status).toBe('idle');
  });

  it('commits the row, token count and change cursor before publishing', async () => {
    const { db, bus, repository } = context;
    bus.publish.mockImplementation((event) => {
      expect(db.select().from(sessionEvents).get()?.id).toBe(event.id);
      expect(db.select().from(sessionEventChanges).get()?.sequence).toBe(event.sequence);
      expect(db.select().from(sessions).get()?.totalTokens).toBe(7);
    });
    await repository.append('s', 'text', { content: 'hello', role: 'user' }, null, {
      promptTokens: 7,
    });
    expect(bus.publish).toHaveBeenCalledOnce();
  });

  it('rolls back every write and publishes nothing when the change write fails', async () => {
    const { db, bus, repository } = context;
    db.run(
      "CREATE TRIGGER reject_changes BEFORE INSERT ON session_event_changes BEGIN SELECT RAISE(ABORT, 'test failure'); END",
    );
    await expect(
      repository.append('s', 'text', { content: 'hello' }, null, { promptTokens: 7 }),
    ).rejects.toThrow('test failure');
    expect(db.select().from(sessionEvents).all()).toEqual([]);
    expect(db.select().from(sessions).get()?.totalTokens).toBe(0);
    expect(bus.publish).not.toHaveBeenCalled();
  });

  it('silent streaming writes remain replayable and preserve snapshot and attempt metadata', async () => {
    const { db, bus, repository } = context;
    const id = await repository.append('s', 'text', { content: 'part', role: 'provider' }, null, {
      attemptId: 'attempt',
      snapshotHash: 'hash',
      completionTokens: 1,
    });
    bus.publish.mockClear();
    await repository.updateSilently(
      id,
      { content: 'complete' },
      { durationMs: 200, completionTokens: 3 },
    );
    expect(bus.publish).not.toHaveBeenCalled();
    const row = await repository.getEventWithMetadata('s', id);
    expect(row?.data).toMatchObject({ content: 'complete', role: 'provider' });
    expect(row?.metadata).toMatchObject({
      attemptId: 'attempt',
      snapshotHash: 'hash',
      durationMs: 200,
      completionTokens: 3,
    });
    expect(db.select().from(sessions).get()?.totalTokens).toBe(3);
    expect(db.select().from(sessionEventChanges).all()).toHaveLength(2);
  });

  it('distinguishes omission from explicit clearing', async () => {
    const { repository } = context;
    const id = await repository.append('s', 'tool_call', {
      toolCallId: 'tool',
      title: 'Old title',
      rawInput: { a: 1 },
      status: 'completed',
    });
    await repository.update(id, { title: undefined, status: 'failed' });
    expect((await repository.getEvent(id))?.data).toMatchObject({
      title: 'Old title',
      rawInput: { a: 1 },
      status: 'failed',
    });
    await repository.update(id, {}, undefined, ['title', 'rawInput']);
    expect((await repository.getEvent(id))?.data).not.toHaveProperty('title');
    expect((await repository.getEvent(id))?.data).not.toHaveProperty('rawInput');
  });

  it('finds stable message identity after the projector cache is gone', async () => {
    const { repository } = context;
    const parent = await repository.append('s', 'text', { role: 'user', content: 'prompt' });
    const id = await repository.append(
      's',
      'text',
      { role: 'provider', content: 'answer', messageId: 'opaque/id' },
      parent,
    );
    expect(await repository.findMessage('s', 'provider', 'opaque/id')).toMatchObject({
      eventId: id,
      text: 'answer',
      parentEventId: parent,
    });
    expect(await repository.findMessage('s', 'thought', 'opaque/id')).toBeUndefined();
  });

  it('backs up and restores history and token accounting', async () => {
    const { repository, db } = context;
    const first = await repository.append('s', 'text', { content: 'first' }, null, {
      completionTokens: 2,
    });
    const last = await repository.append('s', 'text', { content: 'last' }, null, {
      completionTokens: 5,
    });
    const backup = await repository.backupAndDeleteEventsAfter('s', last);
    expect(
      db
        .select()
        .from(sessionEvents)
        .all()
        .map((row) => row.id),
    ).toEqual([first]);
    expect(db.select().from(sessions).get()?.totalTokens).toBe(2);
    await repository.restoreEvents('s', backup);
    expect((await repository.getEvent(last))?.data).toMatchObject({ content: 'last' });
    expect(db.select().from(sessions).get()?.totalTokens).toBe(7);
  });

  it('rejects invalid events without creating a cursor or publishing', async () => {
    const { repository, bus, db } = context;
    await expect(
      repository.append('s', 'terminal_created', { terminalId: 't' } as never),
    ).rejects.toThrow();
    expect(db.select().from(sessionEventChanges).all()).toEqual([]);
    expect(bus.publish).not.toHaveBeenCalled();
  });

  it('transient deltas never write a database row', () => {
    const { repository, db, bus } = context;
    const row = {
      id: 42,
      sessionId: 's',
      type: 'text',
      data: '{}',
      metadata: null,
      parentEventId: null,
      createdAt: new Date(),
    };
    repository.publishTransient(row, ' delta');
    expect(bus.publish).toHaveBeenCalledWith({ ...row, delta: ' delta' });
    expect(db.select().from(sessionEvents).where(eq(sessionEvents.id, 42)).get()).toBeUndefined();
  });
});
