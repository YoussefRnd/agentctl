import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionEngine, coalesceBufferedEvents } from './session-engine.js';
import type { SessionEventRow } from '@agentctl/shared';

// Helper class to mock ReadableStream
class MockStreamController {
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  public stream: ReadableStream<Uint8Array>;

  constructor() {
    this.stream = new ReadableStream({
      start: (c) => {
        this.controller = c;
      },
    });
  }

  public enqueue(text: string) {
    const encoder = new TextEncoder();
    this.controller?.enqueue(encoder.encode(text));
  }

  public close() {
    this.controller?.close();
  }

  public error(err: Error) {
    this.controller?.error(err);
  }
}

describe('SessionEngine', () => {
  let engine: SessionEngine;
  let mockController: MockStreamController;
  let fetchMock: ReturnType<typeof vi.fn>;

  const onEventsUpdate = vi.fn();
  const onStatusChange = vi.fn();
  const onStreamingChange = vi.fn();
  const onError = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    mockController = new MockStreamController();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      body: mockController.stream,
    });

    engine = new SessionEngine({
      sessionId: 'test-session',
      sseUrl: 'http://localhost/api/sessions/test-session/events/stream',
      onEventsUpdate,
      onStatusChange,
      onStreamingChange,
      onError,
    });
  });

  afterEach(() => {
    engine.disconnect();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('should connect and update status', async () => {
    engine.connect();
    // Wait for the async connection logic to resolve fetch
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('http://localhost/api/sessions/test-session/events/stream'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'text/event-stream',
        }) as Record<string, string>,
      }),
    );

    expect(onStatusChange).toHaveBeenCalledWith(true);
    expect(engine.getIsConnected()).toBe(true);
  });

  it('delivers live notices without changing history, streaming state or reconnect cursors', async () => {
    const sessionId = '11111111-1111-4111-8111-111111111111';
    const onNotice = vi.fn();
    engine = new SessionEngine({
      sessionId,
      sseUrl: 'http://localhost/stream',
      onNotice,
      onEventsUpdate,
      onStatusChange,
      onStreamingChange,
      onError,
    });
    engine.connect(5);
    await vi.advanceTimersByTimeAsync(0);
    const notice = {
      type: 'notice',
      sessionId,
      severity: '_future',
      title: 'Integration unavailable',
      description: 'Continuing.',
    };
    onStreamingChange.mockClear();
    mockController.enqueue(`event: session_notice\ndata: ${JSON.stringify(notice)}\n\n`);
    mockController.enqueue(
      `event: session_notice\ndata: ${JSON.stringify({ ...notice, sessionId: '22222222-2222-4222-8222-222222222222' })}\n\n`,
    );
    await vi.advanceTimersByTimeAsync(16);
    expect(onNotice).toHaveBeenCalledExactlyOnceWith(notice);
    expect(onEventsUpdate).not.toHaveBeenCalled();
    expect(onStreamingChange).not.toHaveBeenCalled();
    const replacement = new MockStreamController();
    fetchMock.mockResolvedValue({ ok: true, status: 200, body: replacement.stream });
    mockController.close();
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining('lastEventId=5'),
      expect.any(Object),
    );
    replacement.close();
  });

  it('does not restart a connection while it is opening', async () => {
    let resolveFetch!: (value: unknown) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );

    engine.connect(5);
    engine.connect(6);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('lastEventId=5'),
      expect.any(Object),
    );

    resolveFetch({ ok: true, status: 200, body: mockController.stream });
    await vi.advanceTimersByTimeAsync(0);
    expect(engine.getIsConnected()).toBe(true);
  });

  it('flushes received events when disconnected before the next animation frame', async () => {
    engine.connect();
    await vi.advanceTimersByTimeAsync(0);

    const event = {
      id: 7,
      type: 'status',
      sessionId: '00000000-0000-0000-0000-000000000000',
      createdAt: new Date('2026-06-25T00:00:00.000Z'),
      data: {},
    } as SessionEventRow;
    mockController.enqueue(`id: 7\nevent: acp_event\ndata: ${JSON.stringify(event)}\n\n`);
    await vi.advanceTimersByTimeAsync(0);
    expect(onEventsUpdate).not.toHaveBeenCalled();

    engine.disconnect();
    expect(onEventsUpdate).toHaveBeenCalledWith([event]);
  });

  it('keeps an immediate replacement connection alive after disconnect', async () => {
    engine.connect();
    await vi.advanceTimersByTimeAsync(0);
    engine.disconnect();

    const replacement = new MockStreamController();
    fetchMock.mockResolvedValue({ ok: true, status: 200, body: replacement.stream });
    engine.connect();
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(engine.getIsConnected()).toBe(true);
    replacement.close();
  });

  it('should handle disconnect', async () => {
    engine.connect();
    await vi.advanceTimersByTimeAsync(0);

    expect(engine.getIsConnected()).toBe(true);

    engine.disconnect();
    expect(onStatusChange).toHaveBeenCalledWith(false);
    expect(engine.getIsConnected()).toBe(false);
  });

  it('should buffer and batch events', async () => {
    engine.connect();
    await vi.advanceTimersByTimeAsync(0);

    const event1 = {
      id: 1,
      type: 'status',
      sessionId: '00000000-0000-0000-0000-000000000000',
      createdAt: new Date('2026-06-25T00:00:00.000Z'),
      data: {},
    } as SessionEventRow;

    const event2 = {
      id: 2,
      type: 'status',
      sessionId: '00000000-0000-0000-0000-000000000000',
      createdAt: new Date('2026-06-25T00:00:00.000Z'),
      data: {},
    } as SessionEventRow;

    mockController.enqueue(
      `id: 1\nevent: acp_event\ndata: ${JSON.stringify(event1)}\n\nid: 2\nevent: acp_event\ndata: ${JSON.stringify(event2)}\n\n`,
    );

    // Yield to let the reader loop parse
    await vi.advanceTimersByTimeAsync(0);

    expect(onEventsUpdate).not.toHaveBeenCalled();

    // Advance 16ms to flush buffer
    await vi.advanceTimersByTimeAsync(16);
    expect(onEventsUpdate).toHaveBeenCalledWith([event1, event2]);
  });

  it('should detect streaming state from text events', async () => {
    engine.connect();
    await vi.advanceTimersByTimeAsync(0);

    const textEvent = {
      id: 1,
      type: 'text',
      sessionId: '00000000-0000-0000-0000-000000000000',
      createdAt: new Date('2026-06-25T00:00:00.000Z'),
      data: { content: 'hello' },
    } as SessionEventRow;

    mockController.enqueue(`id: 1\nevent: acp_event\ndata: ${JSON.stringify(textEvent)}\n\n`);

    await vi.advanceTimersByTimeAsync(16);

    expect(onStreamingChange).toHaveBeenCalledWith(1);

    // After 2s of silence, streaming should stop
    await vi.advanceTimersByTimeAsync(2000);
    expect(onStreamingChange).toHaveBeenCalledWith(null);
  });

  it('should stop streaming when a non-text event arrives', async () => {
    engine.connect();
    await vi.advanceTimersByTimeAsync(0);

    const textEvent = {
      id: 1,
      type: 'text',
      sessionId: '00000000-0000-0000-0000-000000000000',
      createdAt: new Date('2026-06-25T00:00:00.000Z'),
      data: { content: 'hello' },
    } as SessionEventRow;

    mockController.enqueue(`id: 1\nevent: acp_event\ndata: ${JSON.stringify(textEvent)}\n\n`);

    await vi.advanceTimersByTimeAsync(16);
    expect(onStreamingChange).toHaveBeenCalledWith(1);

    const statusEvent = {
      id: 2,
      type: 'status',
      sessionId: '00000000-0000-0000-0000-000000000000',
      createdAt: new Date('2026-06-25T00:00:00.000Z'),
      data: {},
    } as SessionEventRow;

    mockController.enqueue(`id: 2\nevent: acp_event\ndata: ${JSON.stringify(statusEvent)}\n\n`);

    await vi.advanceTimersByTimeAsync(16);
    expect(onStreamingChange).toHaveBeenCalledWith(null);
  });

  it('should send auth token if provided', async () => {
    engine = new SessionEngine({
      sessionId: 'test-session',
      sseUrl: 'http://localhost/api/sessions/test-session/events/stream',
      token: 'secret-token',
      onEventsUpdate,
      onStatusChange,
      onStreamingChange,
      onError,
    });

    engine.connect();
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String) as string,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer secret-token',
        }) as Record<string, string>,
      }),
    );
  });

  it('should reconnect on stream end/error using Last-Event-ID', async () => {
    engine.connect();
    await vi.advanceTimersByTimeAsync(0);

    const event1 = {
      id: 5,
      type: 'status',
      sessionId: '00000000-0000-0000-0000-000000000000',
      createdAt: new Date('2026-06-25T00:00:00.000Z'),
      data: {},
    } as SessionEventRow;

    mockController.enqueue(`id: 5\nevent: acp_event\ndata: ${JSON.stringify(event1)}\n\n`);

    await vi.advanceTimersByTimeAsync(16);

    // Reset fetchMock to count next calls
    fetchMock.mockClear();

    // Prepare response for the reconnect attempt
    const newController = new MockStreamController();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      body: newController.stream,
    });

    // Close the current stream
    mockController.close();
    await vi.advanceTimersByTimeAsync(0);

    // Wait 2000ms for reconnect delay
    await vi.advanceTimersByTimeAsync(2000);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('lastEventId=5'),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Last-Event-ID': '5',
        }) as Record<string, string>,
      }),
    );
    newController.close();
  });

  it('should handle parsing error and report via onError', async () => {
    engine.connect();
    await vi.advanceTimersByTimeAsync(0);

    mockController.enqueue(`id: 1\nevent: acp_event\ndata: {invalid-json}\n\n`);

    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalledWith('Failed to parse SSE message');
  });

  it('opts into snapshots and resumes from their high-water mark after older live updates', async () => {
    const sessionId = '00000000-0000-0000-0000-000000000000';
    const onHistorySnapshot = vi.fn();
    engine = new SessionEngine({
      sessionId,
      sseUrl: 'http://localhost/stream',
      onHistorySnapshot,
      onEventsUpdate,
      onStatusChange,
      onStreamingChange,
      onError,
    });
    engine.connect(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock.mock.calls[0][0]).toContain('snapshots=true');
    const event = {
      id: 100,
      sessionId,
      type: 'text' as const,
      data: { role: 'provider' as const, content: 'Latest' },
      createdAt: new Date(),
    };
    mockController.enqueue(
      `id: 100\nevent: session_snapshot\ndata: ${JSON.stringify({ events: [event], nextBeforeId: 100, highWaterId: 100, changeSequence: 900 })}\n\n`,
    );
    mockController.enqueue(
      `id: 2\nevent: session_event\ndata: ${JSON.stringify({ ...event, id: 2, sequence: 901, data: { role: 'provider', content: 'Old streaming update' } })}\n\n`,
    );
    await vi.advanceTimersByTimeAsync(16);
    expect(onHistorySnapshot).toHaveBeenCalledWith({
      events: [event],
      nextBeforeId: 100,
      highWaterId: 100,
      changeSequence: 900,
    });
    expect(onEventsUpdate).toHaveBeenCalled();
    const replacement = new MockStreamController();
    fetchMock.mockResolvedValue({ ok: true, status: 200, body: replacement.stream });
    mockController.close();
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining('lastEventId=100'),
      expect.any(Object),
    );
    expect(fetchMock.mock.calls.at(-1)?.[0]).toContain('afterSequence=901');
    replacement.close();
  });

  it('does not acknowledge malformed messages or snapshots from another session', async () => {
    const sessionId = '00000000-0000-0000-0000-000000000000';
    const onHistorySnapshot = vi.fn();
    engine = new SessionEngine({
      sessionId,
      sseUrl: 'http://localhost/stream',
      onHistorySnapshot,
      onEventsUpdate,
      onStatusChange,
      onStreamingChange,
      onError,
    });
    engine.connect(5);
    await vi.advanceTimersByTimeAsync(0);
    mockController.enqueue('id: 999\nevent: session_event\ndata: {bad}\n\n');
    const event = {
      id: 999,
      sessionId: '11111111-1111-4111-8111-111111111111',
      type: 'text',
      data: { content: 'Wrong session' },
      createdAt: new Date(),
    };
    mockController.enqueue(
      `id: 999\nevent: session_snapshot\ndata: ${JSON.stringify({ events: [event], nextBeforeId: null, highWaterId: 999 })}\n\n`,
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(onHistorySnapshot).not.toHaveBeenCalled();
    const replacement = new MockStreamController();
    fetchMock.mockResolvedValue({ ok: true, status: 200, body: replacement.stream });
    mockController.close();
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining('lastEventId=5'),
      expect.any(Object),
    );
    replacement.close();
  });
});

describe('coalesceBufferedEvents', () => {
  const textEvent = (delta?: string, content = '') =>
    ({
      id: 1,
      type: 'text',
      sessionId: '00000000-0000-0000-0000-000000000000',
      createdAt: new Date('2026-06-25T00:00:00.000Z'),
      data: { content, role: 'provider' },
      ...(delta === undefined ? {} : { delta }),
    }) as SessionEventRow;

  it('combines adjacent deltas for the same streaming event', () => {
    expect(coalesceBufferedEvents([textEvent('Hel'), textEvent('lo'), textEvent('!')])).toEqual([
      expect.objectContaining({ delta: 'Hello!' }),
    ]);
  });

  it('folds a delta into a buffered full row', () => {
    const [event] = coalesceBufferedEvents([textEvent(undefined, 'Hello'), textEvent(' world')]);
    expect(event.delta).toBeUndefined();
    expect(event.data).toEqual({ content: 'Hello world', role: 'provider' });
  });
});
