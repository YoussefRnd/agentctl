import { expect, test, vi } from 'vitest';
import { StreamBuffer } from './stream-buffer.js';

test('StreamBuffer debounces and flushes correct content', async () => {
  const onFlush = vi.fn();
  const buffer = new StreamBuffer(onFlush, 50, 100);

  buffer.append('Hello');
  expect(onFlush).not.toHaveBeenCalled();

  await new Promise((r) => setTimeout(r, 60));
  expect(onFlush).toHaveBeenCalledWith('Hello');
});

test('StreamBuffer flushes immediately when exceeding size limit', () => {
  const onFlush = vi.fn();
  const buffer = new StreamBuffer(onFlush, 1000, 10);

  buffer.append('Hello World!'); // 12 chars
  expect(onFlush).toHaveBeenCalledWith('Hello World!');
});

test('StreamBuffer flushes on maxAgeMs timeout even if debounced repeatedly', async () => {
  const onFlush = vi.fn();
  const buffer = new StreamBuffer(onFlush, 100, 1000, 80);

  buffer.append('A');
  await new Promise((r) => setTimeout(r, 40));
  expect(onFlush).not.toHaveBeenCalled();

  buffer.append('B'); // Resets debounce timer to +100ms, but maxAge is 80ms total
  await new Promise((r) => setTimeout(r, 60));
  expect(onFlush).toHaveBeenCalledWith('AB');
});
