import { describe, expect, it, vi } from 'vitest';
import type { SessionEventRow } from '@agentctl/shared';
import { EventBus } from './event-bus.js';

describe('EventBus state changes', () => {
  it('publishes app state changes for persisted session events, but not streaming deltas', () => {
    const bus = new EventBus();
    const listener = vi.fn();
    bus.subscribeState(listener);

    const event: SessionEventRow = {
      id: 1,
      sessionId: 'session-1',
      type: 'status',
      data: { status: 'running' },
      createdAt: new Date(),
    };
    bus.publish(event);
    bus.publish({ ...event, delta: 'partial' });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        sequence: 1,
        sessionId: 'session-1',
        topics: ['projects', 'session', 'workspace'],
      }),
    );
  });

  it('deduplicates explicitly published topics', () => {
    const bus = new EventBus();
    const event = bus.publishState({ topics: ['providers', 'providers'] });
    expect(event.topics).toEqual(['providers']);
  });
});
