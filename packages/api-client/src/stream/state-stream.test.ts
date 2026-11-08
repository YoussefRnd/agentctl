import { afterEach, expect, test, vi } from 'vite-plus/test';
import { subscribeStateChanges } from './state-stream.js';
import { setApiBaseUrl, setDesktopCapability } from '../api-client.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  setApiBaseUrl('');
  setDesktopCapability('');
});

test('owns authenticated state streaming and ignores reader results after disposal', async () => {
  let complete!: (value: { done: boolean; value?: Uint8Array }) => void;
  let signal!: AbortSignal;
  const releaseLock = vi.fn();
  const reader = {
    cancel: vi.fn(async () => {}),
    read: vi.fn(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    ),
    releaseLock,
  };
  const fetch = vi.fn((_url, options) => {
    signal = options.signal;
    return Promise.resolve({ ok: true, body: { getReader: () => reader } });
  });
  vi.stubGlobal('fetch', fetch);
  setApiBaseUrl('http://desktop.local');
  setDesktopCapability('secret');
  const changed = vi.fn();
  const stop = subscribeStateChanges(changed);
  await vi.waitFor(() => expect(reader.read).toHaveBeenCalled());
  expect(fetch).toHaveBeenCalledWith('http://desktop.local/api/events/stream', {
    headers: { Accept: 'text/event-stream', Authorization: 'Bearer secret' },
    credentials: 'include',
    signal,
  });
  complete({ done: false, value: new TextEncoder().encode('event: state_ready\r\n\r\n') });
  await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce());
  expect(changed.mock.calls[0][0].topics).toEqual([
    'projects',
    'providers',
    'session',
    'workspace',
    'mcp',
    'settings',
  ]);
  stop();
  expect(signal.aborted).toBe(true);
  complete({ done: false, value: new TextEncoder().encode('event: state_ready\n\n') });
  await vi.waitFor(() => expect(releaseLock).toHaveBeenCalledOnce());
  expect(changed).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledOnce();
});

test('cancels a pending body read on disposal and releases the lock', async () => {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({ cancel });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));
  const changed = vi.fn();
  const stop = subscribeStateChanges(changed);
  await vi.waitFor(() => expect(body.locked).toBe(true));

  stop();

  await vi.waitFor(() => expect(body.locked).toBe(false));
  expect(cancel).toHaveBeenCalledOnce();
  expect(changed).not.toHaveBeenCalled();
});

test('dispatches a complete CR-delimited frame at EOF and discards a partial one', async () => {
  vi.useFakeTimers();
  const responses = [new Response('event: state_ready\r\r'), new Response('event: state_ready\r')];
  const fetch = vi.fn().mockImplementation(() => Promise.resolve(responses.shift()));
  vi.stubGlobal('fetch', fetch);
  const changed = vi.fn();
  const stop = subscribeStateChanges(changed);

  await vi.advanceTimersByTimeAsync(0);
  expect(changed).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(2_000);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(changed).toHaveBeenCalledOnce();

  stop();
});

test('settles a reconnect wait on disposal without opening another connection', async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockResolvedValue(new Response(''));
  vi.stubGlobal('fetch', fetch);
  const stop = subscribeStateChanges(vi.fn());
  await vi.waitFor(() => expect(vi.getTimerCount()).toBe(1));
  stop();
  await vi.runAllTimersAsync();
  expect(fetch).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
