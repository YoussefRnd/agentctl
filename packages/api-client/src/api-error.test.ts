import { expect, it } from 'vite-plus/test';
import { ApiError, assertApiStatus } from './api-error.js';

it('preserves server errors and their status, including snapshot recovery details', () => {
  const message = 'Rollback failed. Recovery snapshot: abc123';
  let error: unknown;
  try {
    assertApiStatus({ status: 500, body: { message } }, 200, 'Failed to restore snapshot');
  } catch (failure) {
    error = failure;
  }
  expect(error).toBeInstanceOf(ApiError);
  expect(error).toMatchObject({ message, status: 500 });
});

it.each([undefined, { message: 42 }])(
  'provides an actionable fallback for malformed error bodies: %j',
  (body) => {
    expect(() => assertApiStatus({ status: 502, body }, 200, 'Failed to push changes')).toThrow(
      'Failed to push changes: 502',
    );
  },
);
