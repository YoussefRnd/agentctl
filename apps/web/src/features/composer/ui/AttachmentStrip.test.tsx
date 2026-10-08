// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { AttachmentStrip } from './AttachmentStrip';
import type { PendingAttachment } from '../model/useAttachments';

function makeAttachment(overrides: Partial<PendingAttachment> = {}): PendingAttachment {
  return {
    localId: 'local-1',
    file: new File(['x'], 'img.png', { type: 'image/png' }),
    objectUrl: 'blob:fake',
    mimeType: 'image/png',
    sizeBytes: 1024,
    state: 'ready',
    progress: 100,
    ...overrides,
  };
}

function renderStrip(attachments: PendingAttachment[]) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const onRemove = vi.fn();
  const onRetry = vi.fn();
  act(() => {
    root.render(
      <AttachmentStrip attachments={attachments} onRemove={onRemove} onRetry={onRetry} />,
    );
  });
  return { root, container, onRemove, onRetry };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('AttachmentStrip', () => {
  it('uses the shared viewer for local previews while keeping remove controls independent', () => {
    const { root, onRemove } = renderStrip([makeAttachment()]);
    try {
      expect(document.querySelector('img')?.getAttribute('src')).toBe('blob:fake');
      act(() =>
        document.querySelector<HTMLButtonElement>('[aria-label="Preview img.png"]')!.click(),
      );
      expect(document.querySelector('[role="dialog"] img')?.getAttribute('src')).toBe('blob:fake');
      act(() => document.querySelector<HTMLButtonElement>('[aria-label="Close dialog"]')!.click());
      act(() =>
        document.querySelector<HTMLButtonElement>('[aria-label="Remove attachment"]')!.click(),
      );
      expect(onRemove).toHaveBeenCalledWith('local-1');
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    } finally {
      act(() => root.unmount());
    }
  });

  it('failed upload shows a Retry button that retries instead of removing', () => {
    const { onRemove, onRetry } = renderStrip([makeAttachment({ state: 'error' })]);

    const retryButton = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Retry upload"]',
    );
    expect(retryButton).not.toBeNull();
    expect(retryButton?.getAttribute('aria-label')).toBe('Retry upload');

    act(() => {
      retryButton?.click();
    });

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith('local-1');
    expect(onRemove).not.toHaveBeenCalled();
  });
});
