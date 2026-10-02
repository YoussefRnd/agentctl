import { expect, it, vi } from 'vitest';
import { createDatabase, projects, sessions, sessionEvents } from '../../db/index.js';
import { InputDeliveryService } from './input-delivery-service.js';
import { SessionEventStore } from '../event-store.js';

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
  const store = new SessionEventStore(db, { publish: () => {} });
  const deliver = vi.fn(() =>
    store.append('session', 'text', {
      role: 'user',
      content: 'hello',
      clientMessageId: 'receipt',
      attachmentIds: ['file'],
    }),
  );
  const service = new InputDeliveryService(db);
  const [first, concurrent] = await Promise.all([
    service.accept('session', 'hello', ['file'], 'receipt', deliver),
    service.accept('session', 'hello', ['file'], 'receipt', deliver),
  ]);
  expect(first).toBe(concurrent);
  expect(deliver).toHaveBeenCalledOnce();
  expect(
    await new InputDeliveryService(db).accept('session', 'hello', ['file'], 'receipt', deliver),
  ).toBe(first);
  expect(deliver).toHaveBeenCalledOnce();
  await expect(service.accept('session', 'changed', ['file'], 'receipt', deliver)).rejects.toThrow(
    'different content',
  );
  expect(await db.select().from(sessionEvents)).toHaveLength(1);
});

it('does not turn unaccepted sends into receipts', async () => {
  const db = createDatabase(':memory:');
  const service = new InputDeliveryService(db);
  const deliver = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(42);
  await expect(service.accept('session', 'hello', undefined, 'receipt', deliver)).rejects.toThrow(
    'offline',
  );
  expect(await service.accept('session', 'hello', undefined, 'receipt', deliver)).toBe(42);
  expect(deliver).toHaveBeenCalledTimes(2);
});
