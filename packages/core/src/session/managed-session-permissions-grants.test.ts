import { test, describe, expect } from 'vitest';
import { createDatabase } from '../db/index.js';
import { projects, sessions } from '../db/schema.js';
import { ManagedSession } from './managed-session.js';
import { SessionEventStore } from './event-store.js';
import type { AgentSession } from '../agent/types.js';

interface TestEventBus {
  publish(event: unknown): void;
  waitForEvent(type: string): Promise<{ id: number; type: string; data: string }>;
}

function createTestEventBus(): TestEventBus {
  type EventPayload = { id: number; type: string; data: string };
  const listeners: ((event: EventPayload) => void)[] = [];
  return {
    publish: (event: unknown) => {
      for (const listener of listeners) {
        listener(event as EventPayload);
      }
    },
    waitForEvent: (type: string) => {
      return new Promise<EventPayload>((resolve) => {
        const cb = (evt: EventPayload) => {
          if (evt.type === type) {
            const idx = listeners.indexOf(cb);
            if (idx !== -1) listeners.splice(idx, 1);
            resolve(evt);
          }
        };
        listeners.push(cb);
      });
    },
  };
}

async function makeSession(approvalMode = 'review') {
  const db = createDatabase(':memory:');
  const eventBus = createTestEventBus();
  const eventStore = new SessionEventStore(db, eventBus);

  await db.insert(projects).values({ id: 'proj-g', name: 'Proj', path: '/tmp/proj' });
  await db.insert(sessions).values({
    id: 'sess-g',
    projectId: 'proj-g',
    branch: 'main',
    worktreePath: '/tmp/proj',
    taskSlug: 'test',
    agent: 'test',
    selectedProvider: 'test',
    baseCommit: 'hash',
    approvalMode: approvalMode as 'review',
  });

  const runtimeHandle = {
    id: 'acp-g',
    history: 'fresh',
    closed: new Promise<void>(() => {
      // noop
    }),
    onError: () => {
      // noop
    },
    onClose: () => {
      // noop
    },
  } as unknown as AgentSession;

  const session = new ManagedSession('sess-g', runtimeHandle, db, eventStore, '/tmp/proj');
  return { session, db, eventBus };
}

describe('Permission grant semantics', () => {
  test('agent-native persistent option ids map onto pattern grants', async () => {
    const { session, eventBus } = await makeSession();

    const toolCall = {
      name: 'mock-srv__fs_write',
      toolCallId: 'tc-grant-1',
      arguments: { path: '/tmp/proj/file.txt' },
    };

    // First request: engine has no grants -> goes to pending approval.
    const pendingEventPromise = eventBus.waitForEvent('approval_request');
    const first = session.handleRequestPermission({
      permissionId: 'p-grant-1',
      toolCall,
      options: [
        { optionId: 'allow-once', label: 'Allow once' },
        { optionId: 'allow-session', label: 'Allow for session' },
        { optionId: 'allow_always', label: 'Always allow' },
      ],
    });

    const pendingEvent = await pendingEventPromise;

    // Yield microtask so handleRequestPermission registers pending approval
    await Promise.resolve();

    // User picks the agent-native "allow for session" option.
    session.resolvePermission(String(pendingEvent.id), {
      allowed: true,
      optionId: 'allow-session',
    });

    const firstRes = await first;
    expect(firstRes.allowed).toBe(true);

    // Grant stored: a matching second call must auto-approve without prompting.
    const second = await session.handleRequestPermission({
      permissionId: 'p-grant-2',
      toolCall,
      options: [{ optionId: 'allow-once', label: 'Allow once' }],
    });
    expect(second.allowed).toBe(true);
  });

  test('deny option ids never map onto a positive agent option', async () => {
    const { session, eventBus } = await makeSession();

    const pendingEventPromise = eventBus.waitForEvent('approval_request');
    const first = session.handleRequestPermission({
      permissionId: 'p-deny-1',
      toolCall: { name: 'mock-srv__danger', toolCallId: 'tc-deny-1' },
      options: [{ optionId: 'allow-once', label: 'Allow once' }],
    });

    const pendingEvent = await pendingEventPromise;

    // Yield microtask so handleRequestPermission registers pending approval
    await Promise.resolve();

    // UI sends its own reject_once option id.
    session.resolvePermission(String(pendingEvent.id), { allowed: true, optionId: 'reject_once' });

    const res = await first;
    expect(res.allowed).toBe(false);
  });
});
