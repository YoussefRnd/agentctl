import { SseDecoder, type SseFrame } from './sse-decoder.js';

export function createSseAttempt(lifetime: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (lifetime.aborted) abort();
  else lifetime.addEventListener('abort', abort, { once: true });
  return {
    signal: controller.signal,
    dispose() {
      lifetime.removeEventListener('abort', abort);
      abort();
    },
  };
}

export async function readSseFrames(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onFrame: (frame: SseFrame) => void,
): Promise<void> {
  if (signal.aborted) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const frames = new SseDecoder();
  const cancel = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (signal.aborted) break;
      const batch = done ? frames.finish() : frames.push(decoder.decode(value, { stream: true }));
      for (const frame of batch) {
        if (signal.aborted) return;
        onFrame(frame);
      }
      if (done) break;
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

export function waitToReconnect(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, 2_000);
    signal.addEventListener('abort', finish, { once: true });
  });
}
