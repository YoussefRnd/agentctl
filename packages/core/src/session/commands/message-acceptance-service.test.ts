import { DatabaseSync } from 'node:sqlite';
import { expect, it, vi } from 'vite-plus/test';
import { createDatabase, projects, sessions, sessionEvents } from '../../db/index.js';
import { MessageAcceptanceService } from './message-acceptance-service.js';
import { SessionEventRepository } from '../persistence/session-event-repository.js';

it('deduplicates concurrent requests and lost acknowledgments across restarts', async () => {
  const db = createDatabase(':memory:');
  await db.insert(projects).values({ id: 'project', name: 'project', path: '/tmp/project' });
  await db.insert(sessions).values({
    id: 'session',
    projectId: 'project',
    branch: 'main',
    worktreePath: '/tmp/project',
    taskSlug: 'task',
    baseCommit: 'none',
    agent: 'agent',
    selectedProvider: 'agent',
  });
  const store = new SessionEventRepository(db, { publish: () => {} });
  const deliver = vi.fn(() =>
    store.append('session', 'text', {
      role: 'user',
      content: 'hello',
      clientMessageId: 'receipt',
      attachmentIds: ['file'],
    }),
  );
  const service = new MessageAcceptanceService(db);
  const [first, concurrent] = await Promise.all([
    service.accept('session', 'hello', ['file'], 'receipt', deliver),
    service.accept('session', 'hello', ['file'], 'receipt', deliver),
  ]);
  expect(first).toBe(concurrent);
  expect(deliver).toHaveBeenCalledOnce();
  expect(
    await new MessageAcceptanceService(db).accept('session', 'hello', ['file'], 'receipt', deliver),
  ).toBe(first);
  expect(deliver).toHaveBeenCalledOnce();
  await expect(service.accept('session', 'changed', ['file'], 'receipt', deliver)).rejects.toThrow(
    'different content',
  );
  expect(await db.select().from(sessionEvents)).toHaveLength(1);
});

it('does not turn unaccepted sends into receipts', async () => {
  const db = createDatabase(':memory:');
  const service = new MessageAcceptanceService(db);
  const deliver = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(42);
  await expect(service.accept('session', 'hello', undefined, 'receipt', deliver)).rejects.toThrow(
    'offline',
  );
  expect(await service.accept('session', 'hello', undefined, 'receipt', deliver)).toBe(42);
  expect(deliver).toHaveBeenCalledTimes(2);
});

it('reuses receipt queries across misses and newly committed receipts without caching results', async () => {
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
        agent: 'agent',
        selectedProvider: 'agent',
      })
      .run();
  const service = new MessageAcceptanceService(db);
  expect(await service.findReceipt('a', 'same', 'first')).toBeUndefined();
  const events = new SessionEventRepository(db, { publish() {} });
  const first = await events.append('a', 'text', {
    role: 'user',
    content: 'first',
    clientMessageId: 'same',
  });
  const second = await events.append('b', 'text', {
    role: 'user',
    content: 'second',
    clientMessageId: 'same',
  });
  const prepare = vi.spyOn(DatabaseSync.prototype, 'prepare');
  try {
    expect(await service.findReceipt('a', 'same', 'first')).toBe(first);
    expect(await service.findReceipt('b', 'same', 'second')).toBe(second);
    expect(await service.findReceipt('a', 'missing', 'first')).toBeUndefined();
    await expect(service.findReceipt('a', 'same', 'different')).rejects.toThrow(
      'different content',
    );
    expect(prepare).not.toHaveBeenCalled();
  } finally {
    prepare.mockRestore();
  }
});
