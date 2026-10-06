import { expect, test } from 'vitest';
import { createV2SessionProjector } from './events.js';
import { MAX_TERMINAL_FRAME_BYTES, terminalFrame } from './terminals.js';

test('decodes split UTF-8 per terminal and replaces snapshots including empty output', () => {
  const project = createV2SessionProjector();
  const bytes = Buffer.from('é');
  expect(
    project({
      sessionUpdate: 'terminal_output_chunk',
      terminalId: 'a',
      data: bytes.subarray(0, 1).toString('base64'),
    }),
  ).toEqual([]);
  expect(
    project({
      sessionUpdate: 'terminal_output_chunk',
      terminalId: 'b',
      data: Buffer.from('other').toString('base64'),
    }),
  ).toMatchObject([{ data: 'other', operation: 'append' }]);
  expect(
    project({
      sessionUpdate: 'terminal_output_chunk',
      terminalId: 'a',
      data: bytes.subarray(1).toString('base64'),
    }),
  ).toMatchObject([{ data: 'é', operation: 'append' }]);
  expect(
    project({
      sessionUpdate: 'terminal_update',
      terminalId: 'a',
      output: { data: Buffer.from('snapshot').toString('base64') },
    }),
  ).toMatchObject([{ data: 'snapshot', operation: 'replace' }]);
  expect(
    project({ sessionUpdate: 'terminal_update', terminalId: 'a', output: null }),
  ).toMatchObject([{ data: '', operation: 'replace' }]);
});

test('drops malformed and oversized frames without damaging subsequent updates', () => {
  expect(terminalFrame('invalid!')).toBeUndefined();
  expect(
    terminalFrame(Buffer.alloc(MAX_TERMINAL_FRAME_BYTES + 1).toString('base64')),
  ).toBeUndefined();
  const project = createV2SessionProjector();
  expect(
    project({ sessionUpdate: 'terminal_output_chunk', terminalId: 'a', data: 'invalid!' }),
  ).toEqual([]);
  expect(
    project({ sessionUpdate: 'terminal_output_chunk', terminalId: 'a', data: 'b2s=' }),
  ).toMatchObject([{ data: 'ok' }]);
});
