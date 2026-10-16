import { afterEach, expect, test, vi } from 'vitest';
import { StreamBuffer } from './stream-buffer.js';

afterEach(() => vi.useRealTimers());

test('explicit flush waits for an automatic write and persists later content in order', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const write = vi
    .fn()
    .mockImplementationOnce(() => gate)
    .mockResolvedValue(undefined);
  const buffer = new StreamBuffer(write, 500, 3);
  buffer.append('one');
  buffer.append('two');
  let flushed = false;
  const flushing = buffer.flush().then(() => {
    flushed = true;
  });
  await Promise.resolve();
  expect(flushed).toBe(false);
  expect(write).toHaveBeenCalledExactlyOnceWith('one');
  release();
  await flushing;
  expect(write.mock.calls.map(([content]) => content)).toEqual(['one', 'onetwo']);
});

test('background persistence failures are reported and retain pending content for retry', async () => {
  vi.useFakeTimers();
  const failure = new Error('database busy');
  const write = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined);
  const onError = vi.fn();
  const buffer = new StreamBuffer(write, 10, 1000, 50, onError);
  buffer.append('content');
  await vi.advanceTimersByTimeAsync(10);
  expect(onError).toHaveBeenCalledExactlyOnceWith(failure);
  await buffer.flush();
  expect(write).toHaveBeenCalledTimes(2);
  expect(write).toHaveBeenLastCalledWith('content');
});

test('explicit persistence failure is observable and reset does not retry discarded content', async () => {
  const write = vi
    .fn()
    .mockRejectedValueOnce(new Error('write failed'))
    .mockResolvedValue(undefined);
  const buffer = new StreamBuffer(write);
  buffer.append('old');
  await expect(buffer.flush()).rejects.toThrow('write failed');
  buffer.reset();
  await buffer.flush();
  expect(write).toHaveBeenCalledOnce();
  buffer.append('new');
  await buffer.flush();
  expect(write).toHaveBeenLastCalledWith('new');
});
