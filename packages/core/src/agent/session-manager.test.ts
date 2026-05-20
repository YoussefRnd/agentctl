import { test } from 'vitest';
import assert from 'node:assert/strict';

import { SessionManager } from './session-manager.js';
import type { DbClient, IEventBus } from './acp-session.js';
import { noopLogger } from '../logger.js';

test('SessionManager startSession creates and initializes a session', () => {
  const db = {
    update: () => ({
      set: () => ({
        where: () => Promise.resolve(),
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve([{ id: 1, createdAt: new Date() }]),
      }),
    }),
  } as unknown as DbClient;

  const eventBus = {
    publish: () => undefined,
  } as unknown as IEventBus;

  const manager = new SessionManager(db, eventBus, noopLogger);

  // Mock spawn to not actually start a process
  // This is a bit tricky since startSession calls spawn directly.
  // In a real scenario, we might want to inject spawnImpl, but for now
  // let's just test that it returns a session.

  // NOTE: This test will actually try to spawn 'echo', which is safe on linux.
  const session = manager.startSession('session-1', '/tmp', 'sleep', ['10'], {});

  assert.ok(session);
  assert.equal(session.sessionId, 'session-1');

  // Cleanup
  session.kill();
});

test('SessionManager restartSession kills existing and starts new', () => {
  const db = {
    update: () => ({
      set: () => ({
        where: () => Promise.resolve(),
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve([{ id: 1, createdAt: new Date() }]),
      }),
    }),
  } as unknown as DbClient;

  const eventBus = {
    publish: () => undefined,
  } as unknown as IEventBus;

  const manager = new SessionManager(db, eventBus, noopLogger);

  const session1 = manager.startSession('session-1', '/tmp', 'sleep', ['10']);
  const session2 = manager.restartSession('session-1', '/tmp', {
    command: 'sleep',
    args: ['10'],
  });

  assert.notEqual(session1, session2);
  assert.equal(session2.sessionId, 'session-1');

  // Cleanup
  session2.kill();
});
