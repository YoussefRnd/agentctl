import { getApiBaseUrl, getDesktopCapability } from '../http/configuration.js';
import {
  stateChangeTopicSchema,
  stateChangeEventSchema,
  type StateChangeEvent,
} from '@agentctl/shared';
import { SseDecoder, type SseFrame } from './sse-decoder.js';
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
  let active = true;
  let controller: AbortController | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let finishReconnectWait: (() => void) | null = null;

  const connect = async () => {
    while (active) {
      controller = new AbortController();
      try {
        const headers: Record<string, string> = { Accept: 'text/event-stream' };
        const capability = getDesktopCapability();
        if (capability) headers.Authorization = `Bearer ${capability}`;

        const response = await fetch(`${getApiBaseUrl()}/api/events/stream`, {
          headers,
          credentials: 'include',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`State stream failed: ${String(response.status)}`);
        if (!active) break;
        const reader = response.body?.getReader();
        if (!reader) throw new Error('State stream response has no body');

        const decoder = new TextDecoder();
        const frames = new SseDecoder();
        try {
          while (active) {
            const { value, done } = await reader.read();
            if (done || !active) break;
            for (const frame of frames.push(decoder.decode(value, { stream: true }))) {
              if (active) processStateFrame(frame, onChange);
            }
          }
        } finally {
          reader.releaseLock();
        }
      } catch (error) {
        if (!active || (error instanceof Error && error.name === 'AbortError')) return;
      } finally {
        controller?.abort();
      }

      if (active) {
        await new Promise<void>((resolve) => {
          finishReconnectWait = resolve;
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            finishReconnectWait = null;
            resolve();
          }, 2_000);
        });
      }
    }
  };

  void connect();
  return () => {
    active = false;
    controller?.abort();
    if (reconnectTimer) clearTimeout(reconnectTimer);
    finishReconnectWait?.();
  };
}
