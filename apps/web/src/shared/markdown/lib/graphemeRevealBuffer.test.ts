import { expect, it, vi } from 'vite-plus/test';
import { GraphemeRevealBuffer, splitGraphemes } from './graphemeRevealBuffer';

it.each(['👩🏽‍💻', '🇺🇸🇫🇷', 'e\u0301', '\r\n', '각', 'क्‍ष'])(
  'preserves chunk boundaries in %s, with and without queued output',
  (text) => {
    for (const revealEveryChunk of [false, true]) {
      const buffer = new GraphemeRevealBuffer('prefix ');
      let target = 'prefix ';
      // UTF-16 units intentionally split surrogate pairs as well as grapheme clusters.
      for (let i = 0; i < text.length; i++) {
        target += text[i];
        buffer.update(target);
        if (revealEveryChunk) buffer.reveal(1);
        expect(target.startsWith(buffer.displayed)).toBe(true);
      }
      expect(buffer.reveal(100)).toBe(target);
      expect(buffer.backlog).toBe(0);
      expect(splitGraphemes(buffer.displayed)).toEqual(splitGraphemes(target));
    }
  },
);

it('consumes the cached backlog without re-segmenting on animation frames', () => {
  const segment = vi.spyOn(Intl.Segmenter.prototype, 'segment');
  const buffer = new GraphemeRevealBuffer('old '.repeat(8000));
  buffer.update(buffer.target + '👩🏽‍💻 hello world');
  const calls = segment.mock.calls.length;
  while (buffer.backlog) buffer.reveal(1);
  expect(segment).toHaveBeenCalledTimes(calls);
  expect(segment.mock.calls.at(-1)![0]).toBe(' 👩🏽‍💻 hello world');
  segment.mockRestore();
});

it('discards queued text on replacement, truncation, and completion', () => {
  const buffer = new GraphemeRevealBuffer('original');
  buffer.update('original old backlog');
  buffer.reveal(2);
  expect(buffer.update('replacement')).toEqual({ growth: 0, replaced: true });
  expect(buffer.reveal(100)).toBe('replacement');
  buffer.update('replacement queued');
  buffer.update('replace');
  expect(buffer.backlog).toBe(0);
  expect(buffer.displayed).toBe('replace');
  buffer.update('replace final');
  expect(buffer.finish()).toBe('replace final');
  expect(buffer.backlog).toBe(0);
});

it('handles empty beginnings and large bursts without argument-count limits', () => {
  const buffer = new GraphemeRevealBuffer('');
  const text = 'a'.repeat(150000);
  buffer.update(text);
  buffer.reveal(1100);
  expect(buffer.displayed).toHaveLength(1100);
  expect(buffer.backlog).toBe(text.length - 1100);
  expect(buffer.reveal(text.length)).toBe(text);
});
