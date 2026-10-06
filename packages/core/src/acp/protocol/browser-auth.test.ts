import { expect, test, vi } from 'vitest';
import { requestBrowserAuthentication } from './browser-auth.js';

test('declines unsafe URLs and unknown modes without presenting them', async () => {
  const callback = vi.fn();
  for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'invalid']) {
    expect(
      await requestBrowserAuthentication(
        { mode: 'url', url, elicitationId: 'a' },
        { onBrowserRequest: callback },
      ),
    ).toBe(false);
  }
  expect(callback).not.toHaveBeenCalled();
});

test('waits for explicit browser consent', async () => {
  let accept!: (accepted: boolean) => void;
  const pending = requestBrowserAuthentication(
    { mode: 'url', url: 'https://example.com', elicitationId: 'a', message: 'Sign in' },
    {
      onBrowserRequest: () =>
        new Promise<boolean>((resolve) => {
          accept = resolve;
        }),
    },
  );
  accept(true);
  expect(await pending).toBe(true);
});

test('cancels a pending URL-consent waiter without accepting a late response', async () => {
  const abort = new AbortController();
  let respond!: (value: boolean) => void;
  const pending = requestBrowserAuthentication(
    { mode: 'url', url: 'https://example.com', elicitationId: 'a' },
    {
      signal: abort.signal,
      onBrowserRequest: () =>
        new Promise<boolean>((resolve) => {
          respond = resolve;
        }),
    },
  );
  const rejected = expect(pending).rejects.toMatchObject({ code: -32800 });
  abort.abort();
  await rejected;
  respond(true);
});
