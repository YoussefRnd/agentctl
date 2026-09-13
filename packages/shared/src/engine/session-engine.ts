import { sessionEventRowSchema } from '../schemas/session-event.js';
import type { SessionEventRow } from '../schemas/session-event.js';

export interface SessionEngineOptions {
  sessionId: string;
  sseUrl: string;
  token?: string;
  onEventsUpdate: (events: SessionEventRow[]) => void;
  onStatusChange: (isConnected: boolean) => void;
  onStreamingChange: (streamingEventId: number | null) => void;
  onError?: (error: string) => void;
}

export class SessionEngine {
  private active = false;
  private isConnected = false;
  private lastEventId: number | null = null;
  private abortController: AbortController | null = null;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

  private buffer: SessionEventRow[] = [];
  private flushTimeout: ReturnType<typeof setTimeout> | null = null;
  private streamingTimeout: ReturnType<typeof setTimeout> | null = null;

  // SSE fields accumulator
  private currentEventId: string | null = null;
  private currentEventName: string | null = null;
  private currentEventData = '';

  constructor(private options: SessionEngineOptions) {}

  public connect(lastEventId?: number) {
    if (lastEventId !== undefined) {
      this.lastEventId = lastEventId;
    }

    if (this.active) {
      this.disconnect();
    }

    this.active = true;
    this.isConnected = false;
    this.clearReconnectTimeout();
    void this.startStreaming();
  }

  public disconnect() {
    this.active = false;
    this.isConnected = false;
    this.clearReconnectTimeout();

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    this.handleDisconnect();
  }

  public getIsConnected() {
    return this.isConnected;
  }

  private readActive(): boolean {
    return this.active;
  }

  private readAbortController(): AbortController | null {
    return this.abortController;
  }

  private clearReconnectTimeout() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  private handleDisconnect() {
    this.isConnected = false;
    this.options.onStatusChange(false);
    this.options.onStreamingChange(null);

    if (this.streamingTimeout) {
      clearTimeout(this.streamingTimeout);
      this.streamingTimeout = null;
    }
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
      this.flushTimeout = null;
    }
  }

  private async startStreaming() {
    while (this.readActive()) {
      this.abortController = new AbortController();

      try {
        let url = this.options.sseUrl;
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

        if (this.lastEventId !== null) {
          headers['Last-Event-ID'] = String(this.lastEventId);
        }

        const response = await fetch(url, {
          headers,
          signal: this.abortController.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${String(response.status)}`);
        }

        this.isConnected = true;
        this.options.onStatusChange(true);

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('No readable stream reader in response body');
        }

        const decoder = new TextDecoder();
        let leftover = '';

        while (this.readActive()) {
          const { value, done } = await reader.read();
          if (done) {
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

        if (leftover) {
          this.processLine(leftover);
        }
      } catch (error: unknown) {
        const err = error as { name?: string; message?: string };
        if (err.name === 'AbortError' || !this.readActive()) {
          // Normal abort/disconnect, stop reconnect loop
          break;
        }

        this.options.onError?.(err.message ?? 'SSE connection error');
      } finally {
        if (this.isConnected) {
          this.isConnected = false;
          this.options.onStatusChange(false);
          this.options.onStreamingChange(null);
        }
        const controller = this.readAbortController();
        if (controller) {
          controller.abort();
          this.abortController = null;
        }
      }

      if (this.readActive()) {
        await new Promise<void>((resolve) => {
          this.reconnectTimeout = setTimeout(() => {
            this.reconnectTimeout = null;
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
    if (this.currentEventId) {
      const parsedId = parseInt(this.currentEventId, 10);
      if (!isNaN(parsedId)) {
        this.lastEventId = parsedId;
      }
    }

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

      if (eventName === 'session_event' || eventName === 'acp_event') {
        const parsed = sessionEventRowSchema.parse(JSON.parse(dataStr));
        this.handleEvent(parsed);
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

    this.flushTimeout = setTimeout(() => {
      this.flushTimeout = null;
      if (this.buffer.length > 0) {
        const eventsToFlush = [...this.buffer];
        this.buffer = [];
        this.options.onEventsUpdate(eventsToFlush);
      }
    }, 16);
  }
}
