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

  it('ready attachment shows a remove button that removes', () => {
    const { onRemove, onRetry } = renderStrip([makeAttachment()]);

    const removeButton = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove attachment"]',
    );
    expect(removeButton).not.toBeNull();

    act(() => {
      removeButton?.click();
    });

    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });
});
