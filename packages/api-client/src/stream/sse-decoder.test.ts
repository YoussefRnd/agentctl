import { expect, test } from 'vitest';
import { SseDecoder } from './sse-decoder.js';

test('preserves frames across every CRLF/field chunk boundary and multiline data', () => {
  const input = ': keepalive\r\nevent: session_event\r\nid: 4\r\ndata: {"a":\r\ndata: 1}\r\n\r\n';
  const expected = [{ event: 'session_event', id: '4', data: '{"a":\n1}' }];
  for (let cut = 0; cut <= input.length; cut++) {
    const parser = new SseDecoder();
    expect([...parser.push(input.slice(0, cut)), ...parser.push(input.slice(cut))]).toEqual(
      expected,
    );
  }
  const parser = new SseDecoder();
  expect([...input].flatMap((char) => parser.push(char))).toEqual(expected);
});
test('does not dispatch partial frames or replay fields into the next event', () => {
  const parser = new SseDecoder();
  expect(parser.push('event: state_ready\r')).toEqual([]);
  expect(parser.push('\n\r')).toEqual([]);
  expect(parser.push('\ndata: next\n\n')).toEqual([
    { event: 'state_ready', id: null, data: '' },
    { event: 'message', id: null, data: 'next' },
  ]);
  expect(parser.push('data: partial')).toEqual([]);
  expect(parser.finish()).toEqual([]);
});
