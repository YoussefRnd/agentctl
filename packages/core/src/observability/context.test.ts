import { ROOT_CONTEXT, trace } from '@opentelemetry/api';
import { expect, test } from 'vite-plus/test';
import { restoreTraceContext } from './context.js';

test('restores only valid trace IDs and the sampling bit from stored version-00 context', () => {
  const restored = restoreTraceContext('00-11111111111111111111111111111111-2222222222222222-03');
  expect(trace.getSpanContext(restored)).toEqual({
    traceId: '11111111111111111111111111111111',
    spanId: '2222222222222222',
    traceFlags: 1,
    isRemote: true,
  });
});

test('legacy, corrupt, zero and oversized stored context starts fresh without ambient inheritance', () => {
  for (const value of [
    undefined,
    null,
    '',
    'private context',
    '00-00000000000000000000000000000000-2222222222222222-01',
    '00-11111111111111111111111111111111-0000000000000000-01',
    'ff-11111111111111111111111111111111-2222222222222222-01',
    '00-11111111111111111111111111111111-2222222222222222-01 baggage=private',
    'x'.repeat(100_000),
  ])
    expect(restoreTraceContext(value)).toBe(ROOT_CONTEXT);
});
