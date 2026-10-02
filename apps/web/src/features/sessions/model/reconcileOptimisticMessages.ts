import type { SessionEventRow } from '@agentctl/shared';

/** Replace only the optimistic user messages represented by persisted rows. */
export function reconcileOptimisticMessages(
  existing: SessionEventRow[],
  incoming: SessionEventRow[],
): SessionEventRow[] {
  const result = [...existing];
  for (const message of incoming) {
    if (message.type !== 'text' || message.data.role !== 'user') continue;
    if (result.some((event) => event.id === message.id)) continue;
    const idMatchIndex = message.data.clientMessageId
      ? result.findIndex(
          (event) =>
            event.id < 0 &&
            event.type === 'text' &&
            event.data.clientMessageId === message.data.clientMessageId,
        )
      : -1;
    const activeMatchIndex = result.findIndex(
      (event) =>
        event.id < 0 &&
        event.type === 'text' &&
        event.data.role === 'user' &&
        event.data.content === message.data.content &&
        (event.data.deliveryStatus === 'sending' || event.data.deliveryStatus === 'accepted'),
    );
    const matchingIndex = result.findIndex(
      (event) =>
        event.id < 0 &&
        event.type === 'text' &&
        event.data.role === 'user' &&
        event.data.deliveryStatus !== 'failed' &&
        event.data.content === message.data.content,
    );
    const fallbackIndex = result.findIndex(
      (event) =>
        event.id < 0 &&
        event.type === 'text' &&
        event.data.role === 'user' &&
        event.data.deliveryStatus !== 'queued' &&
        event.data.deliveryStatus !== 'failed',
    );
    const index = message.data.clientMessageId
      ? idMatchIndex
      : activeMatchIndex !== -1
        ? activeMatchIndex
        : matchingIndex !== -1
          ? matchingIndex
          : fallbackIndex;
    if (index !== -1) result[index] = message;
  }
  return result;
}
