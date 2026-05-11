import { describe, it, expect } from 'vitest';
import { EventBus } from './event-bus.js';

describe('EventBus', () => {
  it('delivers events to subscribers for one session only', () => {
    const bus = new EventBus();
    const received: { id: number; sessionId: string }[] = [];

    const stop = bus.subscribe('session-a', (event) => {
      received.push(event);
    });

    bus.publish({ id: 1, sessionId: 'session-a', type: 'text', data: 'hello', createdAt: new Date() });
    bus.publish({ id: 2, sessionId: 'session-b', type: 'text', data: 'bye', createdAt: new Date() });

    stop();

    expect(received).toHaveLength(1);
    expect(received[0]?.id).toBe(1);
  });
});
