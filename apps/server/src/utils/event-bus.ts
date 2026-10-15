import { EventEmitter } from 'node:events';
import type {
  SessionEventRow,
  SessionNotice,
  StateChangeEvent,
  StateChangeTopic,
} from '@agentctl/shared';

export class EventBus {
  private readonly emitter = new EventEmitter();
  private stateSequence = 0;

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  publish(event: SessionEventRow | SessionNotice): void {
    this.emitter.emit(`session:${event.sessionId}`, event);
    if (event.type === 'notice') return;

    // Transient text deltas are high frequency and do not change list or
    // workspace metadata. Persisted events do, so notify app-wide clients.
    const delta = 'delta' in event ? event.delta : undefined;
    if (delta === undefined) {
      const changesWorkspace =
        event.type === 'tool_call' ||
        event.type === 'diff' ||
        event.type === 'terminal_exit' ||
        event.type === 'status';
      this.publishState({
        topics: changesWorkspace ? ['projects', 'session', 'workspace'] : ['projects', 'session'],
        sessionId: event.sessionId,
      });
    }
  }

  publishState(change: { topics: StateChangeTopic[]; sessionId?: string }): StateChangeEvent {
    const event: StateChangeEvent = {
      sequence: ++this.stateSequence,
      topics: [...new Set(change.topics)],
      ...(change.sessionId ? { sessionId: change.sessionId } : {}),
      occurredAt: new Date().toISOString(),
    };
    this.emitter.emit('state-change', event);
    return event;
  }

  subscribeState(callback: (event: StateChangeEvent) => void): () => void {
    this.emitter.on('state-change', callback);
    return () => {
      this.emitter.off('state-change', callback);
    };
  }

  subscribe(
    sessionId: string,
    callback: (event: SessionEventRow | SessionNotice) => void,
  ): () => void {
    const eventName = `session:${sessionId}`;
    this.emitter.on(eventName, callback);
    return () => {
      this.emitter.off(eventName, callback);
    };
  }

  listenerCount(sessionId: string): number {
    return this.emitter.listenerCount(`session:${sessionId}`);
  }

  stateListenerCount(): number {
    return this.emitter.listenerCount('state-change');
  }
}
