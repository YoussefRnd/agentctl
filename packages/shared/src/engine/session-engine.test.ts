import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionEngine } from './session-engine.js';
import type { SessionEventRow } from '../schemas/session-event.js';

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
});
