import {
  orderConversationEvents as orderEvents,
  isComposerOnlyInput,
  type ConversationPreviewEvent,
} from '@agentctl/shared';

export function orderConversationEvents<T extends ConversationPreviewEvent>(events: T[]): T[] {
  return orderEvents(events).filter((event) => !isComposerOnlyInput(event));
}
