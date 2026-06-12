import type { ACPEventRow } from './acp-event-schemas.js';
import { serverEventSchema } from './event-registry.js';

export interface SessionEngineOptions {
  sessionId: string;
  wsUrl: string;
  onEventsUpdate: (events: ACPEventRow[]) => void;
  onStatusChange: (isConnected: boolean) => void;
  onStreamingChange: (streamingEventId: number | null) => void;
  onError?: (error: string) => void;
}

export class SessionEngine {
  private ws: WebSocket | null = null;
  private buffer: ACPEventRow[] = [];
  private flushTimeout: ReturnType<typeof setTimeout> | null = null;
  private streamingTimeout: ReturnType<typeof setTimeout> | null = null;
  private isConnected = false;
  private lastSubscribedSessionId: string | null = null;

  constructor(private options: SessionEngineOptions) {}

  public connect() {
    if (this.ws) {
      this.disconnect();
    }

    this.ws = new WebSocket(this.options.wsUrl);

    this.ws.onopen = () => {
      this.isConnected = true;
      this.options.onStatusChange(true);
    };

    this.ws.onclose = () => {
      this.handleDisconnect();
    };

    this.ws.onerror = () => {
      this.options.onError?.('WebSocket error occurred');
    };

    this.ws.onmessage = (event) => {
      try {
        const data: unknown = JSON.parse(event.data as string);
        const msg = serverEventSchema.parse(data);

        if (msg.type === 'error') {
          this.options.onError?.(msg.error);
          return;
        }

        // type check for narrowing
        if ('payload' in msg) {
          this.handleEvent(msg.payload);
        }
      } catch {
        this.options.onError?.('Failed to parse WebSocket message');
      }
    };
  }

  public disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.handleDisconnect();
  }

  public subscribe(lastEventId: number) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          action: 'subscribe',
          sessionId: this.options.sessionId,
          lastEventId,
        }),
      );
      this.lastSubscribedSessionId = this.options.sessionId;
    }
  }

  public sendMessage(payload: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  private handleDisconnect() {
    this.isConnected = false;
    this.lastSubscribedSessionId = null;
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

  private handleEvent(event: ACPEventRow) {
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
    }, 16); // ~60fps equivalent to requestAnimationFrame
  }

  public getIsConnected() {
    return this.isConnected;
  }
}
