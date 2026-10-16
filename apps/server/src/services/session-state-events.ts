import type { EventBus } from '../utils/event-bus.js';

export function publishSessionChange(
  events: Pick<EventBus, 'publishState'>,
  sessionId: string,
): void {
  events.publishState({ topics: ['projects', 'session'], sessionId });
}

export function publishWorkspaceChange(
  events: Pick<EventBus, 'publishState'>,
  sessionId: string,
): void {
  events.publishState({
    topics: ['projects', 'session', 'workspace'],
    sessionId,
  });
}
