import { afterEach, expect, it, vi } from 'vitest';
import { setApiBaseUrl, setDesktopCapability } from '../api-client.js';
import { fetchAttachment } from './attachments.js';

afterEach(() => {
  setApiBaseUrl('');
  setDesktopCapability('');
  vi.unstubAllGlobals();
});

it('loads attachment bytes from the configured backend with desktop authentication and cancellation', async () => {
  setApiBaseUrl('http://127.0.0.1:43100');
  setDesktopCapability('test-desktop-capability');
  const fetch = vi.fn().mockResolvedValue(new Response(new Blob(['image'], { type: 'image/png' })));
  vi.stubGlobal('fetch', fetch);
  const controller = new AbortController();
  const blob = await fetchAttachment('session /1', 'image /1', controller.signal);
  expect(fetch).toHaveBeenCalledExactlyOnceWith(
    'http://127.0.0.1:43100/api/sessions/session%20%2F1/attachments/image%20%2F1',
    {
      credentials: 'include',
      headers: { Authorization: 'Bearer test-desktop-capability' },
      signal: controller.signal,
    },
  );
  expect(blob.type).toBe('image/png');
  expect(await blob.text()).toBe('image');
});

it('uses cookie authentication for browser previews without placing credentials in the URL', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(new Response(new Blob(['image'], { type: 'image/jpeg' })));
  vi.stubGlobal('fetch', fetch);
  await fetchAttachment('session', 'image');
  expect(fetch).toHaveBeenCalledWith('/api/sessions/session/attachments/image', {
    credentials: 'include',
    headers: {},
    signal: undefined,
  });
});

it('rejects missing attachments and non-image responses', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response('Missing', { status: 404 }))
    .mockResolvedValueOnce(new Response('{}', { headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fetch);
  await expect(fetchAttachment('session', 'image')).rejects.toMatchObject({ status: 404 });
  await expect(fetchAttachment('session', 'image')).rejects.toMatchObject({ status: 415 });
});

it('aborts image uploads and removes the signal listener after completion', async () => {
  const requests: FakeXHR[] = [];
  class FakeXHR {
    upload = { onprogress: null as ((event: ProgressEvent) => void) | null };
    status = 200;
    responseText =
      '{"attachmentId":"image","mimeType":"image/png","filename":"image.png","sizeBytes":1}';
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    abort = vi.fn(() => this.onabort?.());
    open() {}
    setRequestHeader() {}
    send() {}
    constructor() {
      requests.push(this);
    }
  }
  vi.stubGlobal('XMLHttpRequest', FakeXHR);
  const { uploadAttachment } = await import('./attachments.js');
  const controller = new AbortController();
  const remove = vi.spyOn(controller.signal, 'removeEventListener');
  const pending = uploadAttachment(
    'session',
    new File(['x'], 'image.png', { type: 'image/png' }),
    undefined,
    controller.signal,
  );
  const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  await rejection;
  expect(requests[0].abort).toHaveBeenCalledOnce();
  expect(remove).toHaveBeenCalled();
  const completed = new AbortController();
  const success = uploadAttachment(
    'session',
    new File(['x'], 'image.png', { type: 'image/png' }),
    undefined,
    completed.signal,
  );
  requests[1].onload!();
  await expect(success).resolves.toMatchObject({ attachmentId: 'image' });
  completed.abort();
  expect(requests[1].abort).not.toHaveBeenCalled();
});
