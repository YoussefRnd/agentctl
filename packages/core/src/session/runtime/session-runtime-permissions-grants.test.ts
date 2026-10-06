import { test, describe, expect } from 'vitest';
import { createDatabase } from '../../db/index.js';
import { projects, sessions } from '../../db/schema.js';
import { SessionRuntime } from './session-runtime.js';
import { SessionEventRepository } from '../persistence/session-event-repository.js';
import type { AgentSession } from '../../agent/types.js';

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
  const eventRepository = new SessionEventRepository(db, eventBus);

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

  const session = new SessionRuntime('sess-g', runtimeHandle, db, eventRepository, '/tmp/proj');
  return { session, db, eventBus };
}

describe('Permission grant semantics', () => {
  test('agent-native persistent choices remember only the exact request', async () => {
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

  test('agent persistent options with opaque ids retain an exact grant', async () => {
    const { session, eventBus } = await makeSession();
    const toolCall = {
      name: 'mock-srv__fs_write',
      toolCallId: 'tc-grant-opaque',
      arguments: { path: '/tmp/proj/file.txt' },
    };
    const pendingEventPromise = eventBus.waitForEvent('approval_request');
    const pending = session.handleRequestPermission({
      permissionId: 'p-grant-opaque',
      toolCall,
      options: [
        { optionId: 'choice-1', label: 'Allow once', kind: 'allow_once' },
        { optionId: 'choice-2', label: 'Allow for this project', kind: 'allow_always' },
      ],
    });
    const pendingEvent = await pendingEventPromise;
    await Promise.resolve();

    session.resolvePermission(String(pendingEvent.id), { allowed: true, optionId: 'choice-2' });
    await expect(pending).resolves.toEqual({ allowed: true, optionId: 'choice-2' });

    await expect(
      session.handleRequestPermission({
        permissionId: 'p-grant-opaque-again',
        toolCall,
        options: [{ optionId: 'choice-1', label: 'Allow once', kind: 'allow_once' }],
      }),
    ).resolves.toEqual({ allowed: true, optionId: 'choice-1' });
  });

  test('agent reject options with opaque ids remain denied', async () => {
    const { session, eventBus } = await makeSession();

    const pendingEventPromise = eventBus.waitForEvent('approval_request');
    const pending = session.handleRequestPermission({
      permissionId: 'p-deny-opaque',
      toolCall: { name: 'mock-srv__danger', toolCallId: 'tc-deny-opaque' },
      options: [
        { optionId: 'choice-1', label: 'Allow once', kind: 'allow_once' },
        { optionId: 'choice-2', label: 'No, and tell the agent why', kind: 'reject_once' },
      ],
    });
    const pendingEvent = await pendingEventPromise;
    await Promise.resolve();

    session.resolvePermission(String(pendingEvent.id), { allowed: true, optionId: 'choice-2' });

    await expect(pending).resolves.toEqual({ allowed: false, optionId: 'choice-2' });
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

test('cancelling one permission request releases only that waiter and records cancellation', async () => {
  const { session, eventBus, db } = await makeSession();
  const abort = new AbortController();
  const firstEvent = eventBus.waitForEvent('approval_request');
  const first = session.handleRequestPermission(
    {
      permissionId: 'first',
      toolCall: { name: 'read', toolCallId: 'first' },
      options: [{ optionId: 'allow', kind: 'allow_once', label: 'Allow' }],
    },
    abort.signal,
  );
  await firstEvent;
  const secondEvent = eventBus.waitForEvent('approval_request');
  const second = session.handleRequestPermission({
    permissionId: 'second',
    toolCall: { name: 'read', toolCallId: 'second' },
    options: [{ optionId: 'allow', kind: 'allow_once', label: 'Allow' }],
  });
  const secondRow = await secondEvent;
  await Promise.resolve();
  abort.abort();
  expect(await first).toEqual({ allowed: false, cancelled: true });
  expect((await db.query.sessions.findFirst())?.status).toBe('needs_attention');
  session.resolvePermission(String(secondRow.id), { allowed: true, optionId: 'allow' });
  expect(await second).toEqual({ allowed: true, optionId: 'allow' });
  const rows = await db.query.sessionEvents.findMany();
  expect(JSON.parse(rows[0].data).status).toBe('cancelled');
  expect(JSON.parse(rows[1].data).status).toBe('approved');
});
