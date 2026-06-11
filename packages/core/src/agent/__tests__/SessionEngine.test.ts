import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionEngine } from '../SessionEngine.js';
import type { ACPEventRow } from '@agentctl/shared';

// Mock WebSocket
class MockWebSocket {
  public static instances: MockWebSocket[] = [];
  
  // WebSocket constants
  public static readonly CONNECTING = 0;
  public static readonly OPEN = 1;
  public static readonly CLOSING = 2;
  public static readonly CLOSED = 3;

  public readonly CONNECTING = 0;
  public readonly OPEN = 1;
  public readonly CLOSING = 2;
  public readonly CLOSED = 3;

  public onopen: (() => void) | null = null;
  public onclose: (() => void) | null = null;
  public onmessage: ((event: { data: string }) => void) | null = null;
  public onerror: (() => void) | null = null;
  public readyState: number = MockWebSocket.CONNECTING;
  public sentMessages: string[] = [];

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
    this.readyState = MockWebSocket.CONNECTING;
  }

  public send(data: string) {
    this.sentMessages.push(data);
  }

  public close() {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) this.onclose();
  }

  public open() {
    this.readyState = MockWebSocket.OPEN;
    if (this.onopen) this.onopen();
  }

  public emit(data: unknown) {
    if (this.onmessage) this.onmessage({ data: JSON.stringify(data) });
  }

  public static getLast() {
    return MockWebSocket.instances[MockWebSocket.instances.length - 1];
  }

  public static clear() {
    MockWebSocket.instances = [];
  }
}

// overriding global WebSocket for testing
global.WebSocket = MockWebSocket as unknown as typeof WebSocket;

describe('SessionEngine', () => {
  let engine: SessionEngine;
  const onEventsUpdate = vi.fn();
  const onStatusChange = vi.fn();
  const onStreamingChange = vi.fn();
  const onError = vi.fn();

  beforeEach(() => {
    MockWebSocket.clear();
    vi.useFakeTimers();
    engine = new SessionEngine({
      sessionId: 'test-session',
      wsUrl: 'ws://localhost/ws',
      onEventsUpdate,
      onStatusChange,
      onStreamingChange,
      onError,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('should connect and update status', () => {
    engine.connect();
    const ws = MockWebSocket.getLast();
    expect(ws.url).toBe('ws://localhost/ws');
    
    ws.open();
    expect(onStatusChange).toHaveBeenCalledWith(true);
    expect(engine.getIsConnected()).toBe(true);
  });

  it('should handle disconnect', () => {
    engine.connect();
    const ws = MockWebSocket.getLast();
    ws.open();
    
    engine.disconnect();
    expect(onStatusChange).toHaveBeenCalledWith(false);
    expect(engine.getIsConnected()).toBe(false);
  });

  it('should buffer and batch events', () => {
    engine.connect();
    const ws = MockWebSocket.getLast();
    ws.open();

    const event1 = { id: 1, type: 'status' } as ACPEventRow;
    const event2 = { id: 2, type: 'status' } as ACPEventRow;

    ws.emit({ type: 'acp_event', payload: event1 });
    ws.emit({ type: 'acp_event', payload: event2 });

    expect(onEventsUpdate).not.toHaveBeenCalled();

    vi.advanceTimersByTime(16);
    expect(onEventsUpdate).toHaveBeenCalledWith([event1, event2]);
  });

  it('should detect streaming state from text events', () => {
    engine.connect();
    const ws = MockWebSocket.getLast();
    ws.open();

    const textEvent = { id: 1, type: 'text' } as ACPEventRow;
    ws.emit({ type: 'acp_event', payload: textEvent });

    expect(onStreamingChange).toHaveBeenCalledWith(1);

    // After 2s of silence, streaming should stop
    vi.advanceTimersByTime(2000);
    expect(onStreamingChange).toHaveBeenCalledWith(null);
  });

  it('should stop streaming when a non-text event arrives', () => {
    engine.connect();
    const ws = MockWebSocket.getLast();
    ws.open();

    const textEvent = { id: 1, type: 'text' } as ACPEventRow;
    ws.emit({ type: 'acp_event', payload: textEvent });
    expect(onStreamingChange).toHaveBeenCalledWith(1);

    const statusEvent = { id: 2, type: 'status' } as ACPEventRow;
    ws.emit({ type: 'acp_event', payload: statusEvent });
    expect(onStreamingChange).toHaveBeenCalledWith(null);
  });

  it('should handle subscription', () => {
    engine.connect();
    const ws = MockWebSocket.getLast();
    ws.open();
    
    // Explicitly check readyState
    expect(ws.readyState).toBe(MockWebSocket.OPEN);

    engine.subscribe(42);
    expect(ws.sentMessages.length).toBe(1);
    expect(ws.sentMessages[0]).toBe(JSON.stringify({
      action: 'subscribe',
      sessionId: 'test-session',
      lastEventId: 42
    }));
  });
});
