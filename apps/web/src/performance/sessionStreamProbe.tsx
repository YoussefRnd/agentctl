import { memo, useLayoutEffect } from 'react';
import {
  useSessionStream,
  useSessionQueue,
  useSessionPromptEvents,
  useSessionTurnState,
} from '@/features/sessions';
import { EventFeed } from '@/features/conversation';
import type { SessionEventRow } from '@agentctl/shared';

export const STREAM_PROBE_ID = '00000000-0000-4000-8000-000000000002';
export const streamProbeCommits = { queue: 0, turn: 0, prompts: 0 };
const QueueSubscriber = memo(function QueueSubscriber() {
  useSessionQueue();
  useLayoutEffect(() => {
    streamProbeCommits.queue++;
  });
  return null;
});
const TurnSubscriber = memo(function TurnSubscriber() {
  useSessionTurnState();
  useLayoutEffect(() => {
    streamProbeCommits.turn++;
  });
  return null;
});
const PromptSubscriber = memo(function PromptSubscriber() {
  useSessionPromptEvents();
  useLayoutEffect(() => {
    streamProbeCommits.prompts++;
  });
  return null;
});
export function SessionStreamProbeFeed() {
  const { visibleEvents, isConnected } = useSessionStream();
  return (
    <>
      <EventFeed events={visibleEvents} isConnected={isConnected} />
      <QueueSubscriber />
      <TurnSubscriber />
      <PromptSubscriber />
    </>
  );
}

/** Only this fixture's SSE URL is intercepted; other APIs stay blocked by the lab. */
export function installSyntheticStream() {
  const original = window.fetch;
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let closed = false;
  window.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    if (url.pathname !== `/api/sessions/${STREAM_PROBE_ID}/events/stream`)
      return original(input, init);
    const body = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
      },
    });
    init?.signal?.addEventListener(
      'abort',
      () => {
        if (!closed) {
          closed = true;
          controller?.close();
        }
      },
      { once: true },
    );
    return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
  };
  return {
    ready: () => controller !== null,
    send: (event: SessionEventRow) => {
      if (!controller || closed) throw new Error('Synthetic stream is unavailable');
      controller.enqueue(
        new TextEncoder().encode(`event: session_event\ndata: ${JSON.stringify(event)}\n\n`),
      );
    },
    restore: () => {
      window.fetch = original;
      if (!closed) {
        closed = true;
        controller?.close();
      }
    },
  };
}
