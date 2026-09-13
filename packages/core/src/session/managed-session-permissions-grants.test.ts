import { test, describe, expect } from 'vitest';
import { createDatabase } from '../db/index.js';
import { projects, sessions } from '../db/schema.js';
import { ACPSession } from './session-client.js';
import { SessionEventStore } from '../session/event-store.js';
import type { AgentPermissionResponse, AgentSession } from '../agent/types.js';

interface SessionWithPending {
  pendingApprovals: Map<string, (response: AgentPermissionResponse) => void>;
}

async function makeSession(approvalMode = 'review') {
  const db = createDatabase(':memory:');
  const eventStore = new SessionEventStore(db, {
    publish: () => {
      // noop
    },
  });

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

  const session = new ACPSession('sess-g', runtimeHandle, db, eventStore, '/tmp/proj');
  return { session, db };
}

describe('Permission grant semantics', () => {
  test('agent-native persistent option ids map onto pattern grants', async () => {
    const { session } = await makeSession();

    const toolCall = {
      name: 'mock-srv__fs_write',
      toolCallId: 'tc-grant-1',
      arguments: { path: '/tmp/proj/file.txt' },
    };

    // First request: engine has no grants -> goes to pending approval.
    const first = session.handleRequestPermission({
      permissionId: 'p-grant-1',
      toolCall,
      options: [
        { optionId: 'allow-once', label: 'Allow once' },
        { optionId: 'allow-session', label: 'Allow for session' },
        { optionId: 'allow_always', label: 'Always allow' },
      ],
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const sessionWithPending = session as unknown as SessionWithPending;
    expect(sessionWithPending.pendingApprovals.size).toBe(1);

    // User picks the agent-native "allow for session" option.
    const [pendingKey] = Array.from(sessionWithPending.pendingApprovals.entries())[0];
    session.resolvePermission(pendingKey, { allowed: true, optionId: 'allow-session' });

    const firstRes = await first;
    expect(firstRes.allowed).toBe(true);

    // Grant stored: a matching second call must auto-approve without prompting.
    const second = await session.handleRequestPermission({
      permissionId: 'p-grant-2',
      toolCall,
      options: [{ optionId: 'allow-once', label: 'Allow once' }],
    });
    expect(second.allowed).toBe(true);
    expect((session as unknown as SessionWithPending).pendingApprovals.size).toBe(0);
  });

  test('deny option ids never map onto a positive agent option', async () => {
    const { session } = await makeSession();

    const first = session.handleRequestPermission({
      permissionId: 'p-deny-1',
      toolCall: { name: 'mock-srv__danger', toolCallId: 'tc-deny-1' },
      options: [{ optionId: 'allow-once', label: 'Allow once' }],
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const sessionWithPending = session as unknown as SessionWithPending;
    const [pendingKey] = Array.from(sessionWithPending.pendingApprovals.entries())[0];
    // UI sends its own reject_once option id.
    session.resolvePermission(pendingKey, { allowed: true, optionId: 'reject_once' });

    const res = await first;
    expect(res.allowed).toBe(false);
  });
});
