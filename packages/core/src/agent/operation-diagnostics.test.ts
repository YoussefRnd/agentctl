import { afterEach, expect, test, vi } from 'vite-plus/test';
import { noopLogger } from '../logger.js';
import { diagnosticError, OperationDiagnostics } from './operation-diagnostics.js';

afterEach(() => vi.useRealTimers());

test('retains the failing stage and deadline even if a timed-out operation later settles', () => {
  vi.useFakeTimers();
  const trace = new OperationDiagnostics('probe', noopLogger);
  trace.stage('initializing');
  vi.advanceTimersByTime(50);
  trace.stage('opening-session');
  vi.advanceTimersByTime(100);
  const error = Object.assign(new Error('timeout'), { code: -32603 });
  trace.fail(error);
  vi.advanceTimersByTime(200);
  trace.stage('closing-session');
  trace.finish('success');

  expect(diagnosticError(error)).toMatchObject({
    code: -32603,
    operationDiagnostics: {
      outcome: 'error',
      elapsedMs: 150,
      failedStage: 'opening-session',
      stages: [
        { stage: 'initializing', durationMs: 50 },
        { stage: 'opening-session', durationMs: 100 },
      ],
    },
  });
  expect(error.message).toBe('timeout');
});

test('keeps nested transport errors and provider details while redacting credentials', () => {
  const network = Object.assign(new Error('connect failed'), {
    code: 'ETIMEDOUT',
    syscall: 'connect',
  });
  const error = Object.assign(new Error('fetch failed', { cause: new AggregateError([network]) }), {
    stderr: 'private-env-value Bearer opaque-value',
    data: { error: { code: 'upstream_failed', details: '"api_key": "private-json-value"' } },
    downloadUrl: 'https://example.com/archive?signature=private-signature',
  });
  const result = diagnosticError(error, { API_TOKEN: 'private-env-value' });
  expect(result).toMatchObject({
    cause: { errors: [{ code: 'ETIMEDOUT', syscall: 'connect' }] },
    data: { error: { code: 'upstream_failed' } },
  });
  const text = JSON.stringify(result);
  for (const secret of [
    'private-env-value',
    'opaque-value',
    'private-json-value',
    'private-signature',
  ])
    expect(text).not.toContain(secret);
});
