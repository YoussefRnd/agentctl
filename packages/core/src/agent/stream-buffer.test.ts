import { expect, test, vi } from 'vitest';
import { StreamBuffer } from './stream-buffer.js';

test('StreamBuffer debounces and flushes correct content', async () => {
  const onFlush = vi.fn();
  const buffer = new StreamBuffer(onFlush, 50, 100);

  buffer.append('Hello');
  expect(onFlush).not.toHaveBeenCalled();

  await new Promise(r => setTimeout(r, 60));
  expect(onFlush).toHaveBeenCalledWith('Hello');
});

test('StreamBuffer flushes immediately when exceeding size limit', () => {
  const onFlush = vi.fn();
  const buffer = new StreamBuffer(onFlush, 1000, 10);

  buffer.append('Hello World!'); // 12 chars
  expect(onFlush).toHaveBeenCalledWith('Hello World!');
});
