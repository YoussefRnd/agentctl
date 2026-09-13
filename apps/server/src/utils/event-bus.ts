import { EventEmitter } from 'node:events';
import type { SessionEventRow } from '@agentctl/shared';

export class EventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  publish(event: SessionEventRow): void {
    this.emitter.emit(`session:${event.sessionId}`, event);
  }

  subscribe(sessionId: string, callback: (event: SessionEventRow) => void): () => void {
    const eventName = `session:${sessionId}`;
    this.emitter.on(eventName, callback);
    return () => {
      this.emitter.off(eventName, callback);
    };
  }

  listenerCount(sessionId: string): number {
    return this.emitter.listenerCount(`session:${sessionId}`);
  }
}
