import { describe, it, expect, vi } from 'vitest';
import { EventStreamAdapter } from './event-stream-adapter.js';
import type { SessionEventStoreLike } from './contracts.js';

describe('EventStreamAdapter - tool call tracking', () => {
  it('tracks concurrent and interleaved tool calls by toolCallId independently', async () => {
    const appendedEvents: Array<{ id: number; type: string; data: unknown; metadata?: unknown }> =
      [];
    const updatedEvents: Map<number, { data: unknown; metadata?: unknown }> = new Map();
    let nextEventId = 100;

    const mockEventStore: SessionEventStoreLike = {
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

    const adapter = new EventStreamAdapter('sess-1', mockEventStore);

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
    expect((updateB.data as Record<string, unknown>).status).toBe('completed');
  });

  it('persists an update that arrives before its create event', async () => {
    const appended: unknown[] = [];
    const store: SessionEventStoreLike = {
      append: vi.fn(async (_sessionId, _type, data) => {
        appended.push(data);
        return 1;
      }),
      getEvent: vi.fn(async () => null),
      update: vi.fn(async () => {}),
      updateSilently: vi.fn(async () => {}),
      publishTransient: vi.fn(),
    };
    const adapter = new EventStreamAdapter('sess-1', store);

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
    const store: SessionEventStoreLike = {
      append: vi.fn(async () => 7),
      getEvent: vi.fn(async () => null),
      update: vi.fn(async (_id, data) => {
        updates.push(data);
      }),
      updateSilently: vi.fn(async () => {}),
      publishTransient: vi.fn(),
    };
    const adapter = new EventStreamAdapter('sess-1', store);

    await adapter.appendText('partial', 'message-1');
    await adapter.appendText('complete response', 'message-1', 'replace');

    expect(updates).toContainEqual({ content: 'complete response', role: 'provider' });
  });
});
