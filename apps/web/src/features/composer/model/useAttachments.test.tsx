// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { useAttachments } from './useAttachments';

vi.mock('@agentctl/api-client', () => ({
  uploadAttachment: vi.fn(),
}));

import { uploadAttachment } from '@agentctl/api-client';
const mockedUpload = vi.mocked(uploadAttachment);

function makePngFile(name = 'img.png'): File {
  return new File(['x'], name, { type: 'image/png' });
}

function Harness() {
  const { attachments, addFiles, retryAttachment } = useAttachments('sess-1');
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          addFiles([makePngFile()]);
        }}
      >
        add
      </button>
      {attachments.map((a) => (
        <div key={a.localId} data-testid={`att-${a.localId}`} data-state={a.state}>
          <button
            type="button"
            onClick={() => {
              retryAttachment(a.localId);
            }}
          >
            retry
          </button>
        </div>
      ))}
    </div>
  );
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:mock');
  URL.revokeObjectURL = vi.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('useAttachments retryAttachment', () => {
  it('re-uploads a failed attachment and transitions it to ready', async () => {
    mockedUpload
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ attachmentId: 'att-9' } as never);

    act(() => {
      root.render(<Harness />);
    });
    act(() => {
      document.querySelector<HTMLButtonElement>('button')?.click();
    });

    const att = await vi.waitFor(() => {
      const el = document.querySelector('[data-testid^="att-"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    await vi.waitFor(() => {
      expect(att.dataset.state).toBe('error');
    });

    act(() => {
      att.querySelector<HTMLButtonElement>('button')?.click();
    });

    await vi.waitFor(() => {
      expect(att.dataset.state).toBe('ready');
    });
    expect(mockedUpload).toHaveBeenCalledTimes(2);
    expect(mockedUpload).toHaveBeenLastCalledWith('sess-1', expect.any(File), expect.any(Function));
  });
});
