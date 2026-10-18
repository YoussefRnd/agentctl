// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vite-plus/test';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { RenameSessionDialog } from './RenameSessionDialog';

function renderDialog(props: {
  open: boolean;
  currentTitle: string;
  onConfirm: (title: string) => void;
  onCancel: () => void;
}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<RenameSessionDialog {...props} />);
  });
  return { root, container };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('RenameSessionDialog', () => {
  it('submits the typed title via the Save button', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    renderDialog({ open: true, currentTitle: 'Old title', onConfirm, onCancel });

    const input = document.querySelector<HTMLInputElement>('input[type="text"]');
    expect(input).not.toBeNull();
    expect(input?.value).toBe('Old title');

    act(() => {
      // Set the value the way React tracks controlled inputs.
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(input, 'New title');
      input?.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const saveButton = [...document.querySelectorAll('button')].find((b) =>
      b.textContent.includes('Save'),
    );
    expect(saveButton).toBeDefined();
    act(() => {
      saveButton?.click();
    });

    expect(onConfirm).toHaveBeenCalledWith('New title');
    expect(onCancel).not.toHaveBeenCalled();
  });
});
