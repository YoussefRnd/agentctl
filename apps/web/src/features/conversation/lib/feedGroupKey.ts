import type { FeedEventGroup } from './eventFeedGrouping';
export function getGroupKey(group: FeedEventGroup): string {
  return group.type === 'agent' ? group.id : `${group.type}-${String(group.event.id)}`;
}

export function groupHasEvent(group: FeedEventGroup, eventId: number): boolean {
  return 'event' in group
    ? group.event.id === eventId
    : group.events.some((event) => event.id === eventId);
}
