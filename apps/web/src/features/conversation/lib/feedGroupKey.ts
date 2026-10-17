import type { FeedEventGroup } from './eventFeedGrouping';
export function getGroupKey(group: FeedEventGroup): string {
  return group.type === 'agent' ? group.id : `${group.type}-${String(group.event.id)}`;
}
