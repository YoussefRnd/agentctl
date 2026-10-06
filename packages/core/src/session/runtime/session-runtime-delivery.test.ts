import { describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDatabase } from '../../db/index.js';
import {
  projects,
  sessions,
  sessionEvents,
  sessionTurnAttempts,
  sessionOperations,
} from '../../db/schema.js';
import type { AgentSession, AgentMcpGateway } from '../../agent/types.js';
import type { SessionStatusTransitioner } from '../contracts.js';
import { SessionEventRepository } from '../persistence/session-event-repository.js';
import { SessionRuntime } from './session-runtime.js';
import { readSessionExecutionState } from '../execution/session-execution-state.js';
import { sessionExecutionSchema } from '@agentctl/shared';

async function createSession(
  prompt: AgentSession['prompt'],
  runtimeRegistry?: SessionStatusTransitioner,
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
  const eventRepository = new SessionEventRepository(db, { publish: () => undefined });
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
    session: new SessionRuntime(
      'session-delivery',
      runtime,
      db,
      eventRepository,
      '/tmp/project-delivery',
      runtimeRegistry,
      undefined,
      mcpGateway,
    ),
  };
}

describe('SessionRuntime message delivery', () => {
  it('rejects unavailable attachments before accepting or invoking the provider', async () => {
    const prompt = vi.fn<AgentSession['prompt']>(async () => ({ stopReason: 'end_turn' }));
    const accepted = vi.fn();
    const { session, db } = await createSession(prompt);
    await expect(
      session.prompt('hello', ['missing-attachment'], undefined, undefined, accepted),
    ).rejects.toThrow('attachment is unavailable');
    expect(prompt).not.toHaveBeenCalled();
    expect(accepted).not.toHaveBeenCalled();
    expect((await db.select().from(sessionEvents)).filter((row) => row.type === 'text')).toEqual(
      [],
    );
  });
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

  it('records an inserted foreground failure without retiring the healthy runtime', async () => {
    const error = { code: -32000, message: 'Provider quota exhausted', data: { retryable: true } };
    const prompt = vi
      .fn<AgentSession['prompt']>()
      .mockResolvedValueOnce({ stopReason: 'error', error, userMessageId: 'inserted' })
      .mockResolvedValueOnce({ stopReason: 'end_turn' });
    const { db, session } = await createSession(prompt);
    const first = await session.eventRepository.append('session-delivery', 'text', {
      role: 'user',
      content: 'hello',
      deliveryStatus: 'accepted',
    });
    db.insert(sessionOperations)
      .values({
        id: 'operation',
        sessionId: 'session-delivery',
        commandId: 'command',
        kind: 'message',
        fingerprint: 'test',
        payload: '{}',
        eventId: first,
        status: 'running',
      })
      .run();
    db.insert(sessionTurnAttempts)
      .values({
        id: 'attempt',
        sessionId: 'session-delivery',
        operationId: 'operation',
        providerId: 'test-provider',
        status: 'running',
      })
      .run();
    await session.prompt('hello', undefined, undefined, undefined, undefined, undefined, {
      eventId: first,
      attemptId: 'attempt',
    });
    const rows = db
      .select()
      .from(sessionEvents)
      .all()
      .map((row) => ({ ...row, data: JSON.parse(row.data) }));
    expect(rows.find((row) => row.data.status === 'turn_end')?.data).toMatchObject({
      stopReason: 'error',
      error,
    });
    expect(rows.find((row) => row.data.status === 'prompt_failed')?.data).toMatchObject({
      message: error.message,
      error,
    });
    expect(db.select().from(sessionTurnAttempts).get()?.status).toBe('failed');
    expect(db.select().from(sessionOperations).get()?.error).toBe(error.message);
    expect(db.select().from(sessions).get()?.status).toBe('idle');
    expect(session.isDead).toBe(false);
    await session.prompt('try again');
    expect(prompt).toHaveBeenCalledTimes(2);
  });

  it('exposes persisted timing and error details for the attempt without leaking them to the next one', async () => {
    const failure = { code: -32000, message: 'Quota exhausted', data: { retryable: true } };
    let context: Awaited<ReturnType<typeof createSession>>;
    context = await createSession(async () => {
      await context.session.handleDomainEvent({
        type: 'text',
        text: 'partial',
        messageId: 'reply',
      });
      await context.session.handleDomainEvent({
        type: 'user_message_accepted',
        messageId: 'inserted',
      });
      return { stopReason: 'error', error: failure, userMessageId: 'inserted' };
    });
    await context.session.recordRuntimeBinding();
    const first = await context.session.eventRepository.append(
      'session-delivery',
      'text',
      { role: 'user', content: 'first' },
      null,
      { attemptId: 'first' },
    );
    const second = await context.session.eventRepository.append(
      'session-delivery',
      'text',
      { role: 'user', content: 'second' },
      null,
      { attemptId: 'second' },
    );
    for (const [id, eventId] of [
      ['first', first],
      ['second', second],
    ] as const) {
      context.db
        .insert(sessionOperations)
        .values({
          id,
          sessionId: 'session-delivery',
          commandId: id,
          kind: 'message.send',
          fingerprint: id,
          payload: '{}',
          eventId,
          status: id === 'first' ? 'running' : 'pending',
        })
        .run();
      context.db
        .insert(sessionTurnAttempts)
        .values({
          id,
          operationId: id,
          sessionId: 'session-delivery',
          providerId: 'test-provider',
          status: id === 'first' ? 'running' : 'queued',
          startedAt: id === 'first' ? new Date() : undefined,
        })
        .run();
    }
    await context.session.prompt('first', undefined, undefined, undefined, undefined, undefined, {
      eventId: first,
      attemptId: 'first',
    });
    const execution = sessionExecutionSchema.parse(
      readSessionExecutionState(context.db, 'session-delivery'),
    );
    expect(execution).toMatchObject({
      connection: 'connected',
      execution: 'failed',
      attemptId: 'first',
      eventId: first,
      error: failure,
    });
    expect(Object.keys(execution.timings!).sort()).toEqual([
      'acceptanceMs',
      'completionMs',
      'firstOutputMs',
      'preparationMs',
    ]);
    for (const duration of Object.values(execution.timings!))
      expect(duration).toBeGreaterThanOrEqual(0);
    expect(execution.timings!.firstOutputMs).toBeLessThanOrEqual(execution.timings!.completionMs!);
    const failures = context.db
      .select()
      .from(sessionEvents)
      .all()
      .filter((row) => JSON.parse(row.data).status === 'prompt_failed');
    expect(failures).toHaveLength(1);
    expect(failures[0].parentEventId).toBe(first);
    expect(JSON.parse(failures[0].metadata!)).toMatchObject({ attemptId: 'first' });
    expect(
      context.db.select().from(sessionOperations).where(eq(sessionOperations.id, 'first')).get()
        ?.error,
    ).toBe(failure.message);
    context.db
      .update(sessionTurnAttempts)
      .set({ status: 'running', startedAt: new Date() })
      .where(eq(sessionTurnAttempts.id, 'second'))
      .run();
    const next = readSessionExecutionState(context.db, 'session-delivery');
    expect(next).toMatchObject({ execution: 'running', attemptId: 'second', eventId: second });
    expect(next.error).toBeUndefined();
    expect(next.timings).toBeUndefined();
  });

  it('persists cancelled and unfamiliar plan statuses and priorities without rewriting them', async () => {
    const { db, session } = await createSession(async () => ({ stopReason: 'end_turn' }));
    const items = [
      { name: 'Skipped', status: 'cancelled', isCompleted: false, priority: 'low' },
      { name: 'Future', status: 'future_state', isCompleted: false, priority: 'future_priority' },
    ];
    await session.handleDomainEvent({
      type: 'plan_update',
      plan: items,
      artifact: { id: 'plan', kind: 'items', items },
    });
    const record = db.select().from(sessions).get()!;
    expect(JSON.parse(record.plan!)).toEqual(items);
    expect(JSON.parse(record.planArtifacts!)[0].items).toEqual(items);
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
