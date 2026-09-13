import { expect, test } from 'vitest';
import { createDatabase } from '../db/index.js';
import { SessionEventStore } from './event-store.js';
import { ManagedSession } from './managed-session.js';
import type { AgentSession } from '../agent/types.js';

test.each(['fresh', 'restored'] as const)(
  '%s sessions transfer stored history only when the provider has not restored it',
  (history) => {
    const db = createDatabase(':memory:');
    const eventStore = new SessionEventStore(db, { publish() {} });
    const handle = {
      id: 'already-persisted-id',
      history,
      closed: new Promise<void>(() => {}),
      onError() {},
      onClose() {},
    } as unknown as AgentSession;
    const session = new ManagedSession('fork', handle, db, eventStore, '/tmp');
    expect(session.requiresHistoryContext).toBe(history === 'fresh');
    session.markHistoryContextTransferred();
    expect(session.requiresHistoryContext).toBe(false);
  },
);
