// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act, StrictMode } from 'react';
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

describe('Home attachments', () => {
  it('buffers image files until first Send without uploading them', () => {
    let hook!: ReturnType<typeof useAttachments>;
    function DraftHarness() {
      hook = useAttachments('');
      return null;
    }
    act(() => root.render(<DraftHarness />));
    const image = makePngFile();
    act(() => hook.addFiles([image, new File(['x'], 'file.txt', { type: 'text/plain' })]));
    expect(mockedUpload).not.toHaveBeenCalled();
    expect(hook.attachments).toHaveLength(1);
    expect(hook.pendingFiles).toEqual([image]);
    expect(hook.isAnyUploading).toBe(false);
    expect(hook.readyAttachmentIds).toEqual([]);
    act(() => hook.removeAttachment(hook.attachments[0].localId));
    expect(hook.pendingFiles).toEqual([]);
  });
  it('restores draft image previews after a remount, including StrictMode effect replay', () => {
    let hook!: ReturnType<typeof useAttachments>;
    const image = makePngFile();
    let next = 0;
    URL.createObjectURL = vi.fn(() => `blob:${++next}`);
    function DraftHarness() {
      hook = useAttachments('', [image]);
      return null;
    }
    act(() =>
      root.render(
        <StrictMode>
          <DraftHarness />
        </StrictMode>,
      ),
    );
    expect(hook.pendingFiles).toEqual([image]);
    expect(hook.attachments[0].objectUrl).toBe('blob:2');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:1');
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:2');
    expect(mockedUpload).not.toHaveBeenCalled();
    act(() => root.render(null));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:2');
  });
});
