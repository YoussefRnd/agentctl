import { describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDatabase } from '../db/index.js';
import { projects, sessions, sessionEvents } from '../db/schema.js';
import type { AgentSession, AgentMcpGateway } from '../agent/types.js';
import type { SessionStatusTransitioner } from './contracts.js';
import { SessionEventStore } from './event-store.js';
import { ManagedSession } from './managed-session.js';

async function createSession(
  prompt: AgentSession['prompt'],
  stateMachine?: SessionStatusTransitioner,
  mcpGateway?: AgentMcpGateway,
) {
  const db = createDatabase(':memory:');
  await db.insert(projects).values({
    id: 'project-delivery',
    name: 'Delivery test',
    path: '/tmp/project-delivery',
  });
  await db.insert(sessions).values({
    id: 'session-delivery',
    projectId: 'project-delivery',
    branch: 'main',
    worktreePath: '/tmp/project-delivery',
    taskSlug: 'delivery',
    title: 'Delivery test',
    agent: 'test-provider',
    selectedProvider: 'test-provider',
    baseCommit: 'hash',
  });
  const eventStore = new SessionEventStore(db, { publish: () => undefined });
  const runtime = {
    id: 'agent-session-delivery',
    history: 'fresh',
    closed: new Promise<void>(() => undefined),
    onError: () => undefined,
    onClose: () => undefined,
    prompt,
    close: () => Promise.resolve(),
    updateModel: () => Promise.resolve(),
    updateConfigOption: () => [],
  } as unknown as AgentSession;
  return {
    db,
    session: new ManagedSession(
      'session-delivery',
      runtime,
      db,
      eventStore,
      '/tmp/project-delivery',
      stateMachine,
      undefined,
      mcpGateway,
    ),
  };
}

describe('ManagedSession message delivery', () => {
  it('acknowledges only after persisting the user message', async () => {
    let finishPrompt!: () => void;
    const { db, session } = await createSession(
      () =>
        new Promise((resolve) => {
          finishPrompt = () => resolve({ stopReason: 'end_turn' });
        }),
    );
    let accept!: (eventId: number) => void;
    const accepted = new Promise<number>((resolve) => {
      accept = resolve;
    });
    const running = session.prompt('hello', undefined, undefined, undefined, accept);

    const eventId = await accepted;
    const rows = await db.select().from(sessionEvents).where(eq(sessionEvents.id, eventId));
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].data)).toMatchObject({ role: 'user', content: 'hello' });
    expect(
      (await db.query.sessions.findFirst({ where: eq(sessions.id, 'session-delivery') }))?.status,
    ).toBe('running');

    await expect.poll(() => typeof finishPrompt).toBe('function');
    finishPrompt();
    await running;
  });

  it('persists a visible failure if the provider rejects after acceptance', async () => {
    const { db, session } = await createSession(() => Promise.reject(new Error('provider failed')));
    await expect(session.prompt('hello')).rejects.toThrow('provider failed');

    const rows = await db.select().from(sessionEvents);
    const failure = rows.find(
      (row) =>
        row.type === 'status' &&
        (JSON.parse(row.data) as { status?: string }).status === 'prompt_failed',
    );
    expect(failure).toBeDefined();
    expect(
      (await db.query.sessions.findFirst({ where: eq(sessions.id, 'session-delivery') }))?.status,
    ).toBe('error');
  });

  it('waits for the baseline before executing a manual tool', async () => {
    let resolveSnapshot!: (hash: string) => void;
    const snapshot = new Promise<string>((resolve) => {
      resolveSnapshot = resolve;
    });
    const gateway = {
      getTools: vi.fn(async () => []),
      callTool: vi.fn(async () => 'done'),
    } as unknown as AgentMcpGateway;
    const providerPrompt = vi.fn<AgentSession['prompt']>(async () => ({ stopReason: 'end_turn' }));
    const { session } = await createSession(
      providerPrompt,
      {
        transitionTo: async () => {},
        getSnapshotService: () => ({ track: () => snapshot }),
      },
      gateway,
    );
    let accept!: (eventId: number) => void;
    const accepted = new Promise<number>((resolve) => {
      accept = resolve;
    });
    const running = session.prompt('/server:write', undefined, undefined, undefined, accept);
    await accepted;
    expect(gateway.getTools).not.toHaveBeenCalled();
    expect(gateway.callTool).not.toHaveBeenCalled();
    expect(providerPrompt).not.toHaveBeenCalled();
    resolveSnapshot('baseline-hash');
    await running;
    expect(gateway.callTool).toHaveBeenCalledWith('server', 'write', {});
    expect(providerPrompt).toHaveBeenCalledTimes(1);
  });

  it('acknowledges immediately before background workspace snapshot completes', async () => {
    let resolveSnapshot!: (hash: string) => void;
    const snapshotPromise = new Promise<string>((resolve) => {
      resolveSnapshot = resolve;
    });
    const mockSnapshotService = {
      track: vi.fn(() => snapshotPromise),
    };
    const mockStateMachine = {
      transitionTo: () => Promise.resolve(),
      getSnapshotService: () => mockSnapshotService,
    } as unknown as SessionStatusTransitioner;

    let finishPrompt!: () => void;
    const { db, session } = await createSession(
      () =>
        new Promise((resolve) => {
          finishPrompt = () => resolve({ stopReason: 'end_turn' });
        }),
      mockStateMachine,
    );

    let accept!: (eventId: number) => void;
    const accepted = new Promise<number>((resolve) => {
      accept = resolve;
    });
    const running = session.prompt('hello', undefined, undefined, undefined, accept);

    // Should accept immediately even though snapshot tracking is still pending
    const eventId = await accepted;
    expect(eventId).toBeGreaterThan(0);

    let rows = await db.select().from(sessionEvents).where(eq(sessionEvents.id, eventId));
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].data)).toMatchObject({ role: 'user', content: 'hello' });

    // Provider execution must wait even though the input was acknowledged.
    expect(typeof finishPrompt).toBe('undefined');

    // Now resolve the background snapshot
    resolveSnapshot('tree-hash-123');

    // Eventually the metadata in SQLite is updated with snapshotHash
    await expect
      .poll(async () => {
        rows = await db.select().from(sessionEvents).where(eq(sessionEvents.id, eventId));
        return rows[0]?.metadata ? JSON.parse(rows[0].metadata) : null;
      })
      .toMatchObject({ snapshotHash: 'tree-hash-123' });

    await expect.poll(() => typeof finishPrompt).toBe('function');
    finishPrompt();
    await running;
  });
});
