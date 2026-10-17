import type { SessionEventRow } from '@agentctl/shared';
export function coalesceBufferedEvents(events: SessionEventRow[]): SessionEventRow[] {
  const coalesced: SessionEventRow[] = [];

  for (const event of events) {
    const previous = coalesced[coalesced.length - 1];
    const canMergeText =
      previous?.id === event.id &&
      previous.type === 'text' &&
      event.type === 'text' &&
      previous.data.role === event.data.role;

    if (!canMergeText) {
      coalesced.push(event);
      continue;
    }

    if (event.delta === undefined) {
      // A persisted snapshot contains the complete value and supersedes buffered deltas.
      coalesced[coalesced.length - 1] = event;
    } else if (previous.delta !== undefined) {
      coalesced[coalesced.length - 1] = {
        ...event,
        delta: previous.delta + event.delta,
      };
    } else {
      // Fold a delta arriving after a full row into that row before React sees it.
      coalesced[coalesced.length - 1] = {
        ...previous,
        data: {
          ...previous.data,
          content: previous.data.content + event.delta,
        },
      };
    }
  }

  return coalesced;
}
