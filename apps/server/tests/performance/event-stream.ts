import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';

/** Incremental SSE parsing; keeps parsed events for these bounded, synthetic fixtures only. */
export async function openEventStream(url: string, lastId?: number) {
  const request = http.get(url, {
    agent: false,
    headers: lastId === undefined ? {} : { 'last-event-id': String(lastId) },
  });
  // Keep an error listener after headers so deliberate close never becomes an unhandled error.
  request.on('error', () => {});
  const timeout = AbortSignal.timeout(10_000);
  const onTimeout = () => request.destroy(new Error('SSE headers timed out'));
  timeout.addEventListener('abort', onTimeout, { once: true });
  let response: http.IncomingMessage;
  try {
    [response] = (await once(request, 'response')) as [http.IncomingMessage];
  } finally {
    timeout.removeEventListener('abort', onTimeout);
  }
  assert.equal(response.statusCode, 200);
  let pending = '';
  const events: Array<{ id: number; data: Record<string, unknown>; receivedAt: number }> = [];
  response.setEncoding('utf8');
  response.on('error', () => {});
  response.on('data', (chunk: string) => {
    pending += chunk;
    let end: number;
    while ((end = pending.indexOf('\n\n')) >= 0) {
      const frame = pending.slice(0, end);
      pending = pending.slice(end + 2);
      const data = frame.split('\n').find((line) => line.startsWith('data: '));
      const id = frame.split('\n').find((line) => line.startsWith('id: '));
      if (data && id)
        events.push({
          id: Number(id.slice(4)),
          data: JSON.parse(data.slice(6)) as Record<string, unknown>,
          receivedAt: performance.now(),
        });
    }
  });
  return {
    events,
    response,
    close: () => {
      response.destroy();
      request.destroy();
    },
  };
}
