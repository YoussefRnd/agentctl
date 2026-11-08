import { coalesceBufferedEvents } from './coalesce-events.js';
import type { SseFrame } from './sse-decoder.js';
import { createSseAttempt, readSseFrames, waitToReconnect } from './sse-transport.js';
import {
  sessionEventSnapshotSchema,
  sessionEventRowSchema,
  sessionNoticeSchema,
  type SessionEventSnapshot,
  type SessionEventRow,
  type SessionNotice,
} from '@agentctl/shared';

export interface SessionEngineOptions {
  sessionId: string;
  sseUrl: string;
  token?: string;
  compactHistory?: boolean;
  onEventsUpdate: (events: SessionEventRow[]) => void;
  onHistorySnapshot?: (snapshot: SessionEventSnapshot) => void;
  onStatusChange: (isConnected: boolean) => void;
  onStreamingChange: (streamingEventId: number | null) => void;
  onError?: (error: string) => void;
  onNotice?: (notice: SessionNotice) => void;
}

export class SessionEngine {
  private isConnected = false;
  private lastEventId: number | null = null;
  private lastChangeSequence: number | null = null;
  private connection?: AbortController;

  private buffer: SessionEventRow[] = [];
  private flushTimeout: ReturnType<typeof setTimeout> | null = null;
  private streamingTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(private options: SessionEngineOptions) {}

  public connect(lastEventId?: number) {
    if (this.connection) return;
    if (lastEventId !== undefined) this.lastEventId = lastEventId;

    this.connection = new AbortController();
    this.isConnected = false;
    void this.startStreaming(this.connection.signal);
  }

  public disconnect() {
    const connection = this.connection;
    this.connection = undefined;
    connection?.abort();
    this.handleDisconnect();
  }

  public getIsConnected() {
    return this.isConnected;
  }

  private flushBufferedEvents() {
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
      this.flushTimeout = null;
    }
    if (this.buffer.length > 0) {
      const eventsToFlush = coalesceBufferedEvents(this.buffer);
      this.buffer = [];
      this.options.onEventsUpdate(eventsToFlush);
    }
  }

  private handleDisconnect() {
    this.flushBufferedEvents();
    this.isConnected = false;
    this.options.onStatusChange(false);
    this.options.onStreamingChange(null);

    if (this.streamingTimeout) {
      clearTimeout(this.streamingTimeout);
      this.streamingTimeout = null;
    }
  }

  private async startStreaming(lifetime: AbortSignal) {
    while (!lifetime.aborted) {
      const { signal, dispose } = createSseAttempt(lifetime);

      try {
        let url = this.options.sseUrl;
        if (this.options.compactHistory) url += `${url.includes('?') ? '&' : '?'}compact=true`;
        if (this.options.onHistorySnapshot) {
          const separator = url.includes('?') ? '&' : '?';
          url = `${url}${separator}snapshots=true&changes=true`;
          if (this.lastChangeSequence !== null)
            url += `&afterSequence=${String(this.lastChangeSequence)}`;
        }
        if (this.lastEventId !== null) {
          const separator = url.includes('?') ? '&' : '?';
          url = `${url}${separator}lastEventId=${encodeURIComponent(String(this.lastEventId))}`;
        }

        const headers: Record<string, string> = {
          Accept: 'text/event-stream',
        };

        if (this.options.token) {
          headers.Authorization = `Bearer ${this.options.token}`;
        }

        if (this.lastEventId !== null && !this.options.onHistorySnapshot) {
          headers['Last-Event-ID'] = String(this.lastEventId);
        }

        const response = await fetch(url, {
          headers,
          signal,
          credentials: 'include',
        });

        if (lifetime.aborted) break;
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${String(response.status)}`);
        }

        this.isConnected = true;
        this.options.onStatusChange(true);

        if (!response.body) throw new Error('No readable stream reader in response body');
        await readSseFrames(response.body, signal, (frame) => this.dispatchEvent(frame));
      } catch (error: unknown) {
        const err = error as { name?: string; message?: string };
        if (err.name === 'AbortError' || lifetime.aborted) {
          break;
        }

        this.options.onError?.(err.message ?? 'SSE connection error');
      } finally {
        if (!lifetime.aborted) {
          this.flushBufferedEvents();
          if (this.isConnected) {
            this.isConnected = false;
            this.options.onStatusChange(false);
            this.options.onStreamingChange(null);
          }
        }
        dispose();
      }

      await waitToReconnect(lifetime);
    }
  }

  private dispatchEvent({ event: eventName, data: dataStr }: SseFrame) {
    if (!dataStr) {
      return;
    }

    try {
      if (eventName === 'session_notice') {
        const notice = sessionNoticeSchema.parse(JSON.parse(dataStr));
        if (notice.sessionId === this.options.sessionId) this.options.onNotice?.(notice);
        return;
      }
      if (eventName === 'error') {
        const errorData = JSON.parse(dataStr) as { error?: string };
        this.options.onError?.(errorData.error ?? 'Unknown error');
        return;
      }

      if (eventName === 'session_snapshot' && this.options.onHistorySnapshot) {
        const snapshot = sessionEventSnapshotSchema.parse(JSON.parse(dataStr));
        if (
          snapshot.events.some(
            (event) =>
              event.sessionId !== this.options.sessionId || event.id > snapshot.highWaterId,
          )
        ) {
          throw new Error('Invalid session snapshot');
        }
        this.flushBufferedEvents();
        this.options.onHistorySnapshot(snapshot);
        this.lastEventId = snapshot.highWaterId;
        this.lastChangeSequence = snapshot.changeSequence ?? null;
        this.options.onStreamingChange(null);
        if (this.streamingTimeout) clearTimeout(this.streamingTimeout);
        this.streamingTimeout = null;
        return;
      }

      if (eventName === 'session_event' || eventName === 'acp_event') {
        const parsed = sessionEventRowSchema.parse(JSON.parse(dataStr));
        this.handleEvent(parsed);
        if (parsed.sequence !== undefined)
          this.lastChangeSequence = Math.max(this.lastChangeSequence ?? 0, parsed.sequence);
        // Updates and turn anchors can refer to old IDs; they must not rewind catch-up.
        this.lastEventId = Math.max(this.lastEventId ?? 0, parsed.id);
      }
    } catch {
      this.options.onError?.('Failed to parse SSE message');
    }
  }

  private handleEvent(event: SessionEventRow) {
    this.buffer.push(event);
    this.scheduleFlush();

    if (event.type === 'text') {
      this.options.onStreamingChange(event.id);

      if (this.streamingTimeout) {
        clearTimeout(this.streamingTimeout);
      }
      this.streamingTimeout = setTimeout(() => {
        this.options.onStreamingChange(null);
        this.streamingTimeout = null;
      }, 2000);
    } else {
      this.options.onStreamingChange(null);
      if (this.streamingTimeout) {
        clearTimeout(this.streamingTimeout);
        this.streamingTimeout = null;
      }
    }
  }

  private scheduleFlush() {
    if (this.flushTimeout) return;
    this.flushTimeout = setTimeout(() => this.flushBufferedEvents(), 16);
  }
}
