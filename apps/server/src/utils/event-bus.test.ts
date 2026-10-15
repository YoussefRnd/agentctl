import { describe, expect, it, vi } from 'vitest';
import type { SessionEventRow } from '@agentctl/shared';
import { EventBus } from './event-bus.js';

describe('EventBus state changes', () => {
  it('delivers notices only to the matching session without invalidating app state', () => {
    const bus = new EventBus();
    const session = vi.fn();
    const other = vi.fn();
    const state = vi.fn();
    bus.subscribe('session', session);
    bus.subscribe('other', other);
    bus.subscribeState(state);
    const notice = {
      type: 'notice' as const,
      sessionId: 'session',
      severity: 'error',
      title: 'Integration unavailable',
    };
    bus.publish(notice);
    expect(session).toHaveBeenCalledExactlyOnceWith(notice);
    expect(other).not.toHaveBeenCalled();
    expect(state).not.toHaveBeenCalled();
  });
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
