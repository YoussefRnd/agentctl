import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { MessageEditor } from './MessageEditor';

let root: ReturnType<typeof createRoot> | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = '';
});

it('blocks unchanged, empty, and duplicate submissions while preserving the draft on failure', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  let resolve!: (value: boolean) => void;
  const submit = vi.fn(
    () =>
      new Promise<boolean>((done) => {
        resolve = done;
      }),
  );
  const cancel = vi.fn();
  act(() =>
    root!.render(<MessageEditor initialValue="Original" onSubmit={submit} onCancel={cancel} />),
  );
  const textarea = container.querySelector('textarea')!;
  const save = () =>
    [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent === 'Save',
    )!;
  expect(save().disabled).toBe(true);
  const input = (value: string) =>
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
        textarea,
        value,
      );
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
  input('  ');
  expect(save().disabled).toBe(true);
  input('Changed');
  act(() =>
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        ctrlKey: true,
        isComposing: true,
        bubbles: true,
      }),
    ),
  );
  expect(submit).not.toHaveBeenCalled();
  act(() => {
    save().click();
    save().click();
  });
  expect(submit).toHaveBeenCalledExactlyOnceWith('Changed');
  expect(textarea.readOnly).toBe(true);
  act(() => textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(cancel).not.toHaveBeenCalled();
  await act(async () => resolve(false));
  expect(textarea.value).toBe('Changed');
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  expect(save().disabled).toBe(false);
  act(() =>
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true }),
    ),
  );
  expect(cancel).not.toHaveBeenCalled();
  act(() => textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(cancel).toHaveBeenCalledOnce();
});
