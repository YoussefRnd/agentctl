import { expect, test } from 'vitest';
import type { UpdateSessionNotification } from '@agentclientprotocol/sdk/experimental/v2';
import { withV2StateErrors } from './state-error-compatibility.js';

const error = { code: -32000, message: 'Quota exhausted', data: { retryable: true } };
function frame(sessionId: string, details: unknown, meta?: Record<string, unknown> | null) {
  return {
    jsonrpc: '2.0',
    method: 'session/update',
    params: {
      sessionId,
      update: {
        sessionUpdate: 'state_update',
        state: 'idle',
        stopReason: 'error',
        error: details,
        ...(meta !== undefined ? { _meta: meta } : {}),
      },
    },
  };
}

test.each([undefined, null, { provider: 'metadata' }])(
  'restores error and original metadata %j after SDK decoding',
  async (meta) => {
    const original = frame('session', error, meta);
    const stream = withV2StateErrors({
      readable: new ReadableStream<typeof original>({
        start(controller) {
          controller.enqueue(original);
          controller.close();
        },
      }),
      writable: new WritableStream<typeof original>(),
    });
    const encoded = (await stream.readable.getReader().read()).value!;
    // SDK 1.7 drops the new error field but preserves the supported metadata field.
    const { error: _, ...decoded } = encoded.params.update;
    expect(
      stream.restore({ ...encoded.params, update: decoded } as UpdateSessionNotification),
    ).toEqual(original.params);
    expect(original.params.update._meta).toEqual(meta);
  },
);

test('keeps errors isolated across batched sessions and ignores malformed error objects', async () => {
  const originals = [
    frame('first', error),
    frame('second', { code: 'invalid', message: 'bad' }),
    frame('third', { code: -32603, message: 'Other failure' }),
  ];
  const stream = withV2StateErrors({
    readable: new ReadableStream<typeof originals>({
      start(controller) {
        controller.enqueue(originals);
        controller.close();
      },
    }),
    writable: new WritableStream<typeof originals>(),
  });
  const encoded = (await stream.readable.getReader().read()).value!;
  const restored = encoded.map(({ params }) => {
    const { error: _, ...update } = params.update;
    return stream.restore({ ...params, update } as UpdateSessionNotification);
  });
  expect(restored[0]).toEqual(originals[0].params);
  expect(restored[1].update).not.toHaveProperty('error');
  expect(restored[2]).toEqual(originals[2].params);
});
