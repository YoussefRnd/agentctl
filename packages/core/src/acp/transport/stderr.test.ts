import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { expect, test } from 'vitest';
import {
  observeAcpStderr,
  sanitizeStderr,
  stderrExcerpt,
  STDERR_TAIL_BYTES,
  withProcessDiagnostics,
} from './stderr.js';

test('bounds stderr and redacts secrets split across chunks while preserving protocol error codes', () => {
  const stderr = new PassThrough();
  const child = Object.assign(new EventEmitter(), { stderr }) as unknown as ChildProcess;
  observeAcpStderr(child, { API_TOKEN: 'private-example-token', HOME: '/home/example' });
  stderr.write('x'.repeat(10000));
  stderr.write('\nCannot load /home/example/agent: private-example-');
  stderr.write('token\nBearer opaque-value');
  const excerpt = stderrExcerpt(child);
  expect(Buffer.byteLength(excerpt)).toBeLessThanOrEqual(STDERR_TAIL_BYTES);
  expect(excerpt).toContain('Cannot load ~/agent');
  expect(excerpt).not.toContain('private-example');
  expect(excerpt).not.toContain('opaque-value');
  const error = Object.assign(new Error('RPC rejected'), { code: -32602 });
  expect(withProcessDiagnostics(error, child)).toBe(error);
  expect(error.code).toBe(-32602);
  expect(error.message).toBe('RPC rejected');
  expect(error).toHaveProperty('processDiagnostics', excerpt);
});

test('redacts common credentials and authentication URL query parameters', () => {
  expect(
    sanitizeStderr('x-api-key: private\nhttps://example.com/login?token=secret\nghp_tokenvalue'),
  ).toBe('[redacted credential]\nhttps://example.com/login?[redacted query]\n[redacted]');
});
