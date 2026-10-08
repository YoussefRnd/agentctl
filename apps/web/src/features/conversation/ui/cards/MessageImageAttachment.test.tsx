import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MessageImageAttachment } from './MessageImageAttachment';

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@agentctl/api-client', () => ({ fetchAttachment: mocks.fetch }));
const attachment = {
  attachmentId: 'image-1',
  filename: 'image.png',
  mimeType: 'image/png',
  sizeBytes: 10,
};
let root: Root | undefined;
beforeEach(() => {
  mocks.fetch.mockReset().mockResolvedValue(new Blob(['image'], { type: 'image/png' }));
  let next = 0;
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = vi.fn(() => 'blob:preview-' + ++next);
      static revokeObjectURL = vi.fn();
    },
  );
});
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});
async function render(id = 'image-1') {
  if (!root) {
    const container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  }
  await act(async () =>
    root!.render(
      <MessageImageAttachment
        sessionId="session-1"
        attachment={{ ...attachment, attachmentId: id }}
      />,
    ),
  );
}

it('loads an authenticated thumbnail and opens the shared viewer without refetching', async () => {
  await render();
  expect(mocks.fetch).toHaveBeenCalledWith('session-1', 'image-1', expect.any(AbortSignal));
  expect(document.querySelector('img')?.getAttribute('src')).toBe('blob:preview-1');
  act(() => document.querySelector<HTMLButtonElement>('[aria-label="Preview image.png"]')!.click());
  expect(document.querySelector('[role="dialog"] img')?.getAttribute('src')).toBe('blob:preview-1');
  act(() =>
    document
      .querySelector('[role="dialog"]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
  );
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(mocks.fetch).toHaveBeenCalledOnce();
});

it('shows a retryable fallback for fetch and decode errors', async () => {
  mocks.fetch.mockRejectedValueOnce(new Error('Unauthorized'));
  await render();
  expect(document.body.textContent).toContain('Image unavailable');
  expect(document.querySelector('img')).toBeNull();
  await act(async () =>
    document.querySelector<HTMLButtonElement>('[aria-label="Retry loading image.png"]')!.click(),
  );
  expect(document.querySelector('img')?.getAttribute('src')).toBe('blob:preview-1');
  act(() => document.querySelector('img')!.dispatchEvent(new Event('error')));
  expect(document.querySelector('img')).toBeNull();
  expect(document.body.textContent).toContain('Image unavailable');
  await act(async () =>
    document.querySelector<HTMLButtonElement>('[aria-label="Retry loading image.png"]')!.click(),
  );
  expect(document.querySelector('img')?.getAttribute('src')).toBe('blob:preview-2');
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-1');
});

it('cancels stale requests and revokes blob URLs when changing attachments or unmounting', async () => {
  let resolve!: (value: Blob) => void;
  mocks.fetch.mockImplementationOnce(
    () =>
      new Promise<Blob>((done) => {
        resolve = done;
      }),
  );
  await render();
  const signal = mocks.fetch.mock.calls[0][2] as AbortSignal;
  expect(document.body.textContent).toContain('Loading image');
  await render('image-2');
  expect(signal.aborted).toBe(true);
  await act(async () => resolve(new Blob(['stale'], { type: 'image/png' })));
  expect(URL.createObjectURL).toHaveBeenCalledOnce();
  act(() => root!.unmount());
  root = undefined;
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-1');
  expect((mocks.fetch.mock.calls[1][2] as AbortSignal).aborted).toBe(true);
});
