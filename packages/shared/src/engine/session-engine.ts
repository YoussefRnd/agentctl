import {
  sessionEventSnapshotSchema,
  type SessionEventSnapshot,
} from '../schemas/session-event-page.js';
import { sessionEventRowSchema } from '../schemas/session-event.js';
import type { SessionEventRow } from '../schemas/session-event.js';

export interface SessionEngineOptions {
  sessionId: string;
  sseUrl: string;
  token?: string;
  onEventsUpdate: (events: SessionEventRow[]) => void;
  onHistorySnapshot?: (snapshot: SessionEventSnapshot) => void;
  onStatusChange: (isConnected: boolean) => void;
  onStreamingChange: (streamingEventId: number | null) => void;
  onError?: (error: string) => void;
}

export function coalesceBufferedEvents(events: SessionEventRow[]): SessionEventRow[] {
  const coalesced: SessionEventRow[] = [];

  for (const event of events) {
    const previous = coalesced[coalesced.length - 1];
    const canMergeText =
      previous?.id === event.id &&
      previous.type === 'text' &&
      event.type === 'text' &&
      previous.data.role === event.data.role;

    if (!canMergeText) {
      coalesced.push(event);
      continue;
    }

    if (event.delta === undefined) {
      // A persisted snapshot contains the complete value and supersedes buffered deltas.
      coalesced[coalesced.length - 1] = event;
    } else if (previous.delta !== undefined) {
      coalesced[coalesced.length - 1] = {
        ...event,
        delta: previous.delta + event.delta,
      };
    } else {
      // Fold a delta arriving after a full row into that row before React sees it.
      coalesced[coalesced.length - 1] = {
        ...previous,
        data: {
          ...previous.data,
          content: previous.data.content + event.delta,
        },
      };
    }
  }

  return coalesced;
}

export class SessionEngine {
  private active = false;
  private isConnected = false;
  private lastEventId: number | null = null;
  private lastChangeSequence: number | null = null;
  private abortController: AbortController | null = null;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private resolveReconnectWait: (() => void) | null = null;
  private runId = 0;

  private buffer: SessionEventRow[] = [];
  private flushTimeout: ReturnType<typeof setTimeout> | null = null;
  private streamingTimeout: ReturnType<typeof setTimeout> | null = null;

  // SSE fields accumulator
  private currentEventId: string | null = null;
  private currentEventName: string | null = null;
  private currentEventData = '';

  constructor(private options: SessionEngineOptions) {}

  public connect(lastEventId?: number) {
    if (this.active) return;

    if (lastEventId !== undefined) {
      this.lastEventId = lastEventId;
    }

    this.active = true;
    this.isConnected = false;
    const runId = ++this.runId;
    void this.startStreaming(runId);
  }

  public disconnect() {
    this.active = false;
    ++this.runId;
    this.clearReconnectTimeout();

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    this.handleDisconnect();
    this.currentEventId = null;
    this.currentEventName = null;
    this.currentEventData = '';
  }

  public getIsConnected() {
    return this.isConnected;
  }

  private readActive(runId: number): boolean {
    return this.active && this.runId === runId;
  }

  private clearReconnectTimeout() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.resolveReconnectWait?.();
    this.resolveReconnectWait = null;
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

  private async startStreaming(runId: number) {
    while (this.readActive(runId)) {
      const controller = new AbortController();
      this.abortController = controller;

      try {
        let url = this.options.sseUrl;
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
          signal: controller.signal,
          credentials: 'include',
        });

        if (!this.readActive(runId)) break;
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${String(response.status)}`);
        }

        this.isConnected = true;
        this.options.onStatusChange(true);

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('No readable stream reader in response body');
        }

        this.currentEventId = null;
        this.currentEventName = null;
        this.currentEventData = '';
        const decoder = new TextDecoder();
        let leftover = '';

        while (this.readActive(runId)) {
          const { value, done } = await reader.read();
          if (done || !this.readActive(runId)) {
            break;
          }

          const chunk = decoder.decode(value, { stream: true });
          const text = leftover + chunk;
          const lines = text.split(/\r\n|\r|\n/);
          leftover = lines.pop() ?? '';

          for (const line of lines) {
            this.processLine(line);
          }
        }

        if (leftover && this.readActive(runId)) {
          this.processLine(leftover);
        }
      } catch (error: unknown) {
        const err = error as { name?: string; message?: string };
        if (err.name === 'AbortError' || !this.readActive(runId)) {
          break;
        }

        this.options.onError?.(err.message ?? 'SSE connection error');
      } finally {
        if (this.runId === runId) {
          this.flushBufferedEvents();
          if (this.isConnected) {
            this.isConnected = false;
            this.options.onStatusChange(false);
            this.options.onStreamingChange(null);
          }
        }
        controller.abort();
        if (this.abortController === controller) {
          this.abortController = null;
        }
      }

      if (this.readActive(runId)) {
        await new Promise<void>((resolve) => {
          this.resolveReconnectWait = resolve;
          this.reconnectTimeout = setTimeout(() => {
            this.reconnectTimeout = null;
            this.resolveReconnectWait = null;
            resolve();
          }, 2000);
        });
      }
    }
  }

  private processLine(line: string) {
    if (line.startsWith(':')) {
      return;
    }

    if (line.trim() === '') {
      this.dispatchEvent();
      return;
    }

    const colonIndex = line.indexOf(':');
    let field = line;
    let value = '';

    if (colonIndex !== -1) {
      field = line.substring(0, colonIndex);
      value = line.substring(colonIndex + 1);
      if (value.startsWith(' ')) {
        value = value.substring(1);
      }
    }

    switch (field) {
      case 'id':
        this.currentEventId = value;
        break;
      case 'event':
        this.currentEventName = value;
        break;
      case 'data':
        this.currentEventData = this.currentEventData
          ? `${this.currentEventData}\n${value}`
          : value;
        break;
      default:
        break;
    }
  }

  private dispatchEvent() {
    const eventName = this.currentEventName ?? 'message';
    const dataStr = this.currentEventData;

    this.currentEventId = null;
    this.currentEventName = null;
    this.currentEventData = '';

    if (!dataStr) {
      return;
    }

    try {
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
