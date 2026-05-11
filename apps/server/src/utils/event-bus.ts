import { EventEmitter } from 'node:events';
import type { ACPEventRow } from '../types.js';

export class EventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  publish(event: ACPEventRow): void {
    this.emitter.emit(`session:${event.sessionId}`, event);
  }

  subscribe(sessionId: string, callback: (event: ACPEventRow) => void): () => void {
    const eventName = `session:${sessionId}`;
    this.emitter.on(eventName, callback);
    return () => {
      this.emitter.off(eventName, callback);
    };
  }
}
