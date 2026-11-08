import { getApiBaseUrl, getDesktopCapability } from '../http/configuration.js';
import {
  stateChangeTopicSchema,
  stateChangeEventSchema,
  type StateChangeEvent,
} from '@agentctl/shared';
import type { SseFrame } from './sse-decoder.js';
import { createSseAttempt, readSseFrames, waitToReconnect } from './sse-transport.js';
function processStateFrame({ event, data }: SseFrame, onChange: (event: StateChangeEvent) => void) {
  if (event === 'state_ready') {
    onChange({
      sequence: 0,
      topics: [...stateChangeTopicSchema.options],
      occurredAt: new Date().toISOString(),
    });
  } else if (event === 'state_change' && data) {
    try {
      const parsed = stateChangeEventSchema.safeParse(JSON.parse(data));
      if (parsed.success) onChange(parsed.data);
    } catch {
      /* Reconnect reconciliation repairs malformed/missed state. */
    }
  }
}
/** Subscribe once per host/cache lifetime; disposal aborts I/O and settles reconnect waits. */
export function subscribeStateChanges(onChange: (event: StateChangeEvent) => void): () => void {
  const lifetime = new AbortController();

  const connect = async () => {
    while (!lifetime.signal.aborted) {
      const { signal, dispose } = createSseAttempt(lifetime.signal);
      try {
        const headers: Record<string, string> = { Accept: 'text/event-stream' };
        const capability = getDesktopCapability();
        if (capability) headers.Authorization = `Bearer ${capability}`;

        const response = await fetch(`${getApiBaseUrl()}/api/events/stream`, {
          headers,
          credentials: 'include',
          signal,
        });
        if (signal.aborted) break;
        if (!response.ok) throw new Error(`State stream failed: ${String(response.status)}`);
        if (!response.body) throw new Error('State stream response has no body');
        await readSseFrames(response.body, signal, (frame) => processStateFrame(frame, onChange));
      } catch (error) {
        if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) return;
      } finally {
        dispose();
      }

      await waitToReconnect(lifetime.signal);
    }
  };

  void connect();
  return () => lifetime.abort();
}
