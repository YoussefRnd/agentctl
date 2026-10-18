import { createDatabase, projects, sessions, sessionEvents } from '../../db/index.js';
import { SessionEventRepository } from '../persistence/session-event-repository.js';
import { describe, it, test, expect, vi } from 'vite-plus/test';
import { ConversationProjector } from './conversation-projector.js';
import type { SessionEventRepositoryLike } from '../contracts.js';

describe('ConversationProjector - tool call tracking', () => {
  it('tracks concurrent and interleaved tool calls by toolCallId independently', async () => {
    const appendedEvents: Array<{ id: number; type: string; data: unknown; metadata?: unknown }> =
      [];
    const updatedEvents: Map<number, { data: unknown; metadata?: unknown }> = new Map();
    let nextEventId = 100;

    const mockEventStore: SessionEventRepositoryLike = {
      append: vi.fn(async (_sessionId, type, data, _parentId, metadata) => {
        const id = nextEventId++;
        appendedEvents.push({ id, type, data, metadata });
        return id;
      }),
      getEvent: vi.fn(async () => null),
      update: vi.fn(async (eventId, data, metadata) => {
        updatedEvents.set(eventId, { data, metadata });
      }),
      updateSilently: vi.fn(async () => {}),
      publishTransient: vi.fn(),
    };

    const adapter = new ConversationProjector('sess-1', mockEventStore);

    // 1. Tool Call A starts
    await adapter.upsertToolCall({
      toolCallId: 'call_A',
      name: 'read_file',
      title: 'read_file',
      status: 'in_progress',
    });

    expect(appendedEvents).toHaveLength(1);
    expect(appendedEvents[0].id).toBe(100);

    // 2. Tool Call B starts before Tool Call A finishes
    await adapter.upsertToolCall({
      toolCallId: 'call_B',
      name: 'run_command',
      title: 'run_command',
      status: 'in_progress',
    });

    expect(appendedEvents).toHaveLength(2);
    expect(appendedEvents[1].id).toBe(101);

    // 3. Tool Call A sends an update (e.g. progress or completion)
    await adapter.upsertToolCall({
      toolCallId: 'call_A',
      status: 'completed',
      rawOutput: { output: 'file contents' },
    });

    // Must update Event 100 (call_A), NOT Event 101 (call_B)!
    expect(updatedEvents.has(100)).toBe(true);
    const updateA = updatedEvents.get(100);
    expect(updateA).toBeDefined();
    if (!updateA) throw new Error('call_A update missing');
    expect((updateA.data as Record<string, unknown>).toolCallId).toBe('call_A');
    expect((updateA.data as Record<string, unknown>).status).toBe('completed');
    expect(updatedEvents.has(101)).toBe(false);

    // 4. Finalize in-flight tool calls (Call B was still in_progress)
    await adapter.finalizeInFlightToolCalls();

    expect(updatedEvents.has(101)).toBe(true);
    const updateB = updatedEvents.get(101);
    expect(updateB).toBeDefined();
    if (!updateB) throw new Error('call_B update missing');
    expect((updateB.data as Record<string, unknown>).toolCallId).toBe('call_B');
    expect((updateB.data as Record<string, unknown>).status).toBe('unknown');
  });

  it('persists an update that arrives before its create event', async () => {
    const appended: unknown[] = [];
    const store: SessionEventRepositoryLike = {
      append: vi.fn(async (_sessionId, _type, data) => {
        appended.push(data);
        return 1;
      }),
      getEvent: vi.fn(async () => null),
      update: vi.fn(async () => {}),
      updateSilently: vi.fn(async () => {}),
      publishTransient: vi.fn(),
    };
    const adapter = new ConversationProjector('sess-1', store);

    await adapter.upsertToolCall({
      toolCallId: 'late-create',
      name: 'read_file',
      status: 'completed',
    });

    expect(appended).toEqual([
      { toolCallId: 'late-create', name: 'read_file', status: 'completed' },
    ]);
  });

  it('replaces a message by provider message id', async () => {
    const updates: unknown[] = [];
    const store: SessionEventRepositoryLike = {
      append: vi.fn(async () => 7),
      getEvent: vi.fn(async () => null),
      update: vi.fn(async (_id, data) => {
        updates.push(data);
      }),
      updateSilently: vi.fn(async () => {}),
      publishTransient: vi.fn(),
    };
    const adapter = new ConversationProjector('sess-1', store);

    await adapter.appendText('partial', 'message-1');
    await adapter.appendText('complete response', 'message-1', 'replace');

    expect(updates).toContainEqual({ content: 'complete response', role: 'provider' });
  });
});

describe('ACP tool snapshots across turns', () => {
  it('retains delegation metadata, string results, and late content on one persisted row', async () => {
    const { parseNotificationToEvents } = await import('../../acp/protocol/events.js');
    const { sessionEventToolCallDataSchema } = await import('@agentctl/shared');
    const rows = new Map<number, { data: Record<string, unknown>; type: string }>();
    let id = 0;
    const store: SessionEventRepositoryLike = {
      append: vi.fn(async (_session, type, data) => {
        rows.set(++id, { type, data: JSON.parse(JSON.stringify(data)) });
        return id;
      }),
      getEvent: vi.fn(async (eventId) => {
        const row = rows.get(eventId);
        return row ? { id: eventId, ...row } : null;
      }),
      update: vi.fn(async (eventId, data) => {
        const row = rows.get(eventId)!;
        const fields = Object.fromEntries(
          Object.entries(data as Record<string, unknown>).filter(
            ([, value]) => value !== undefined,
          ),
        );
        const merged = { ...row.data, ...fields };
        row.data = sessionEventToolCallDataSchema.parse(JSON.parse(JSON.stringify(merged)));
      }),
      updateSilently: vi.fn(async () => {}),
      publishTransient: vi.fn(),
    };
    const adapter = new ConversationProjector('session-1', store);
    const send = async (update: Parameters<typeof parseNotificationToEvents>[0]['update']) => {
      for (const event of parseNotificationToEvents({ sessionId: 'session-1', update })) {
        if (event.type === 'tool_call') await adapter.upsertToolCall(event.call);
      }
    };
    await send({
      sessionUpdate: 'tool_call',
      toolCallId: 'opaque-id',
      name: 'task',
      title: 'Review',
      kind: 'other',
      status: 'in_progress',
      rawInput: { prompt: 'Review files' },
    });
    await adapter.finalizeInFlightToolCalls();
    expect(rows.get(1)?.data.status).toBe('unknown');
    await adapter.startTurn('Parent continues');
    await send({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'opaque-id',
      status: 'completed',
      rawOutput: 'Found one bug',
    });
    await adapter.upsertToolCall(
      {
        toolCallId: 'opaque-id',
        content: [{ type: 'content', content: { type: 'text', text: 'Late result details' } }],
      },
      'append',
    );
    const tools = [...rows.values()].filter((row) => row.type === 'tool_call');
    expect(tools).toHaveLength(1);
    expect(tools[0].data).toMatchObject({
      name: 'task',
      title: 'Review',
      arguments: { prompt: 'Review files' },
      status: 'completed',
      rawOutput: 'Found one bug',
      content: [{ type: 'content', content: { text: 'Late result details' } }],
    });
    await adapter.finalizeInFlightToolCalls();
    expect(rows.get(1)?.data.status).toBe('completed');
  });

  it.each(['cancelled', 'interrupted'] as const)(
    'records %s without claiming successful completion',
    async (status) => {
      const update = vi.fn(async () => {});
      const store: SessionEventRepositoryLike = {
        append: vi.fn(async () => 1),
        update,
        getEvent: vi.fn(async () => null),
        updateSilently: vi.fn(async () => {}),
        publishTransient: vi.fn(),
      };
      const adapter = new ConversationProjector('session-1', store);
      await adapter.upsertToolCall({ name: 'task', toolCallId: 'a', status: 'in_progress' });
      await adapter.finalizeInFlightToolCalls(status);
      expect(update).toHaveBeenCalledWith(
        1,
        { toolCallId: 'a', status },
        expect.objectContaining({ durationMs: expect.any(Number) }),
      );
    },
  );
});

test('freezes duration after completion even when repeated snapshots and output arrive later', async () => {
  let now = 1000;
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
  const update = vi.fn(async () => {});
  const store: SessionEventRepositoryLike = {
    append: vi.fn(async () => 1),
    update,
    getEvent: vi.fn(async () => null),
    updateSilently: vi.fn(async () => {}),
    publishTransient: vi.fn(),
  };
  try {
    const adapter = new ConversationProjector('session-1', store);
    await adapter.upsertToolCall({ name: 'task', toolCallId: 'a', status: 'in_progress' });
    now = 2000;
    await adapter.upsertToolCall({ toolCallId: 'a', status: 'completed' });
    now = 5000;
    await adapter.upsertToolCall({
      toolCallId: 'a',
      status: 'completed',
      rawOutput: 'Late result',
    });
    expect(update).toHaveBeenLastCalledWith(
      1,
      expect.objectContaining({ rawOutput: 'Late result' }),
      { durationMs: 1000 },
    );
  } finally {
    clock.mockRestore();
  }
});

test('bounds retained tool identities and leaves evicted unfinished calls unconfirmed', async () => {
  let nextId = 0;
  const update = vi.fn(async () => {});
  const store: SessionEventRepositoryLike = {
    append: vi.fn(async () => ++nextId),
    update,
    getEvent: vi.fn(async () => null),
    updateSilently: vi.fn(async () => {}),
    publishTransient: vi.fn(),
  };
  const adapter = new ConversationProjector('session-1', store);
  for (let i = 0; i < 257; i++)
    await adapter.upsertToolCall({ name: 'task', toolCallId: `task-${i}`, status: 'in_progress' });
  expect(update).toHaveBeenCalledWith(1, { status: 'unknown' }, expect.any(Object));
  update.mockClear();
  await adapter.finalizeInFlightToolCalls();
  expect(update).toHaveBeenCalledTimes(256);
});

it('updates an older identified message across turns and projector recreation without changing its parent', async () => {
  const db = createDatabase(':memory:');
  db.insert(projects).values({ id: 'p', name: 'Project', path: '/tmp' }).run();
  db.insert(sessions)
    .values({
      id: 's',
      projectId: 'p',
      branch: 'main',
      worktreePath: '/tmp',
      taskSlug: 'task',
      baseCommit: 'none',
      agent: 'provider',
      selectedProvider: 'provider',
    })
    .run();
  const bus = { publish: vi.fn() };
  const repository = new SessionEventRepository(db, bus);
  const projector = new ConversationProjector('s', repository);
  const first = await projector.startTurn('first');
  await projector.appendText('old', 'a', 'replace');
  await projector.appendText('other', 'b', 'replace');
  await projector.startTurn('second');
  await projector.appendText('new', 'c', 'replace');
  await projector.appendText('corrected', 'a', 'replace');
  await projector.appendText(' tail', 'a');
  await projector.flushAll();
  expect(projector.getTransientSnapshots()[0].parentEventId).toBe(first.eventId);
  const restored = new ConversationProjector('s', repository);
  await restored.startTurn('third');
  await restored.appendText('final', 'a', 'replace');
  await restored.flushAll();
  const messages = db
    .select()
    .from(sessionEvents)
    .all()
    .filter((row) => JSON.parse(row.data).role === 'provider');
  expect(messages).toHaveLength(3);
  expect(messages[0].parentEventId).toBe(first.eventId);
  expect(JSON.parse(messages[0].data).content).toBe('final');
});

it('merges user echoes and preserves cross-role message IDs and late corrections', async () => {
  const db = createDatabase(':memory:');
  db.insert(projects).values({ id: 'p', name: 'Project', path: '/tmp' }).run();
  db.insert(sessions)
    .values({
      id: 's',
      projectId: 'p',
      branch: 'main',
      worktreePath: '/tmp',
      taskSlug: 'task',
      baseCommit: 'none',
      agent: 'provider',
      selectedProvider: 'provider',
    })
    .run();
  const repository = new SessionEventRepository(db, { publish: vi.fn() });
  const projector = new ConversationProjector('s', repository);
  const first = await projector.startTurn('hello');
  await projector.appendUserText('hel', 'user-1', 'append');
  await projector.appendUserText('lo', 'user-1', 'append');
  await projector.appendText('answer', 'user-1');
  await projector.flushAll();
  const second = await projector.startTurn('second');
  await projector.appendUserText('corrected', 'user-1', 'replace');
  await projector.appendUserText('second', 'user-2', 'replace');
  const users = db
    .select()
    .from(sessionEvents)
    .all()
    .filter((row) => JSON.parse(row.data).role === 'user');
  expect(users.map((row) => row.id)).toEqual([first.eventId, second.eventId]);
  expect(users.map((row) => JSON.parse(row.data))).toMatchObject([
    { content: 'corrected', messageId: 'user-1' },
    { content: 'second', messageId: 'user-2' },
  ]);
  const providers = db
    .select()
    .from(sessionEvents)
    .all()
    .filter((row) => JSON.parse(row.data).role === 'provider');
  expect(providers).toHaveLength(1);
  expect(JSON.parse(providers[0].data)).toMatchObject({
    content: 'answer',
    messageId: 'user-1',
  });
});

it('uses the accepted ID to distinguish identical user messages from other clients', async () => {
  const db = createDatabase(':memory:');
  db.insert(projects).values({ id: 'p', name: 'Project', path: '/tmp' }).run();
  db.insert(sessions)
    .values({
      id: 's',
      projectId: 'p',
      branch: 'main',
      worktreePath: '/tmp',
      taskSlug: 'task',
      baseCommit: 'none',
      agent: 'provider',
      selectedProvider: 'provider',
    })
    .run();
  const repository = new SessionEventRepository(db, { publish: vi.fn() });
  const projector = new ConversationProjector('s', repository);
  const local = await projector.startTurn('same content', undefined, undefined, 'local-id');
  await projector.acceptUserMessage('canonical-id');
  await projector.appendUserText('same content', 'other-client-id', 'replace');
  await projector.appendUserText('same ', 'canonical-id', 'append');
  await projector.appendUserText('content', 'canonical-id', 'append');
  await projector.appendText('answer', 'reply');
  await projector.flushAll();
  const rows = db.select().from(sessionEvents).all();
  const users = rows.filter((row) => JSON.parse(row.data).role === 'user');
  expect(users).toHaveLength(2);
  expect(JSON.parse(users.find((row) => row.id === local.eventId)!.data)).toMatchObject({
    content: 'same content',
    clientMessageId: 'local-id',
    messageId: 'canonical-id',
  });
  expect(JSON.parse(users.find((row) => row.id !== local.eventId)!.data)).toMatchObject({
    content: 'same content',
    messageId: 'other-client-id',
  });
  expect(rows.find((row) => JSON.parse(row.data).role === 'provider')?.parentEventId).toBe(
    local.eventId,
  );
});
