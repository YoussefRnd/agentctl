import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vite-plus/test';
import {
  Button,
  ConfirmationModal,
  FormField,
  Select,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
} from './index.js';
let root: Root;
function render(element: React.ReactNode) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(element));
}
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = '';
  vi.useRealTimers();
});
it('connects select validation to existing labels and descriptions without dangling IDs', () => {
  render(
    <FormField label="Theme" description="Choose colors" error="Choose a theme" required>
      <Select value="dark" onChange={() => {}} options={[{ value: 'dark', label: 'Dark' }]} />
    </FormField>,
  );
  const button = document.querySelector('button')!;
  expect(document.querySelector('label')!.htmlFor).toBe(button.id);
  expect(button.getAttribute('aria-invalid')).toBe('true');
  expect(button.getAttribute('aria-required')).toBe('true');
  expect(button.hasAttribute('aria-describedby')).toBe(false);
  expect(document.getElementById(button.getAttribute('aria-errormessage')!)?.textContent).toBe(
    'Choose a theme',
  );
});
it('keeps tab keyboard navigation when consumers provide handlers and skips disabled tabs', () => {
  const keys = vi.fn();
  const clicks = vi.fn();
  function Example() {
    const [value, setValue] = useState('one');
    return (
      <Tabs value={value} onValueChange={setValue}>
        <TabsList aria-label="Panels" onKeyDown={keys}>
          <TabsTrigger value="one">One</TabsTrigger>
          <TabsTrigger value="disabled" disabled>
            Disabled
          </TabsTrigger>
          <TabsTrigger value="three" onClick={clicks}>
            Three
          </TabsTrigger>
        </TabsList>
        <TabsContent value="one">First panel</TabsContent>
        <TabsContent value="three">Third panel</TabsContent>
      </Tabs>
    );
  }
  render(<Example />);
  const tabs = document.querySelectorAll<HTMLButtonElement>('[role=tab]');
  act(() => {
    tabs[0]!.focus();
    tabs[0]!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
    );
  });
  expect(document.activeElement).toBe(tabs[2]);
  expect(tabs[2]!.getAttribute('aria-selected')).toBe('true');
  expect(document.getElementById(tabs[2]!.getAttribute('aria-controls')!)!.textContent).toBe(
    'Third panel',
  );
  expect(keys).toHaveBeenCalledOnce();
  expect(clicks).toHaveBeenCalledOnce();
  act(() => {
    tabs[2]!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }),
    );
  });
  expect(document.activeElement).toBe(tabs[0]);
});
it('associates confirmation text and allows Escape cancellation', () => {
  const cancel = vi.fn();
  render(
    <ConfirmationModal
      isOpen
      title="Remove item"
      message="This removes the selected item."
      onConfirm={() => {}}
      onCancel={cancel}
    />,
  );
  const dialog = document.querySelector('[role=dialog]')!;
  expect(document.getElementById(dialog.getAttribute('aria-describedby')!)!.textContent).toBe(
    'This removes the selected item.',
  );
  act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(cancel).toHaveBeenCalledOnce();
});
it('opens tooltips on keyboard focus with an accessible description and closes without stealing focus', async () => {
  vi.useFakeTimers();
  render(
    <Tooltip content="More details" delayDuration={0}>
      <Button>Inspect</Button>
    </Tooltip>,
  );
  const button = document.querySelector('button')!;
  await act(async () => {
    button.focus();
  });
  const tooltip = document.querySelector('[role=tooltip]');
  expect(tooltip?.textContent).toBe('More details');
  expect(button.getAttribute('aria-describedby')).toBe(tooltip?.id);
  expect(document.activeElement).toBe(button);
  act(() => {
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  expect(button.hasAttribute('aria-describedby')).toBe(false);
});
it('keeps action buttons out of form submission unless explicitly marked submit', () => {
  const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
  const action = vi.fn();
  render(
    <form onSubmit={submit}>
      <Button onClick={action}>Action</Button>
      <Button type="submit">Submit</Button>
    </form>,
  );
  const [actionButton, submitButton] = document.querySelectorAll('button');
  act(() => actionButton!.click());
  expect(action).toHaveBeenCalledTimes(1);
  expect(submit).not.toHaveBeenCalled();
  act(() => submitButton!.click());
  expect(submit).toHaveBeenCalledTimes(1);
});
it('restores focus for controlled dialogs opened without a DialogTrigger', async () => {
  vi.useFakeTimers();
  function Example() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button onClick={() => setOpen(true)}>Open confirmation</Button>
        <ConfirmationModal
          isOpen={open}
          title="Remove item"
          message="Confirm removal."
          onCancel={() => setOpen(false)}
          onConfirm={() => setOpen(false)}
        />
      </>
    );
  }
  render(<Example />);
  const opener = document.querySelector('button')!;
  act(() => {
    opener.focus();
    opener.click();
  });
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  await act(async () =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
  );
  act(() => vi.advanceTimersByTime(0));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(opener);
});

it('blocks dismissal while confirming and allows cancellation after a failed attempt', () => {
  const cancel = vi.fn();
  const confirm = vi.fn();
  render(
    <ConfirmationModal
      isOpen
      title="Remove"
      message="Remove item?"
      onConfirm={confirm}
      onCancel={cancel}
    />,
  );
  const clickConfirm = () =>
    [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === 'Proceed')!
      .click();
  act(clickConfirm);
  expect(confirm).toHaveBeenCalledOnce();
  act(() =>
    root.render(
      <ConfirmationModal
        isOpen
        isConfirming
        title="Remove"
        message="Remove item?"
        onConfirm={confirm}
        onCancel={cancel}
      />,
    ),
  );
  act(() =>
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    ),
  );
  expect(cancel).not.toHaveBeenCalled();
  expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-busy')).toBe('true');
  expect(
    [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].every(
      (button) => button.disabled,
    ),
  ).toBe(true);
  act(() =>
    root.render(
      <ConfirmationModal
        isOpen
        title="Remove"
        message="Remove item?"
        onConfirm={confirm}
        onCancel={cancel}
      />,
    ),
  );
  act(() =>
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    ),
  );
  expect(cancel).toHaveBeenCalledOnce();
});

it('keeps a confirmation cancellable when its action leaves the controlled dialog open', () => {
  const cancel = vi.fn();
  render(
    <ConfirmationModal
      isOpen
      title="Remove"
      message="Remove item?"
      onConfirm={() => {}}
      onCancel={cancel}
    />,
  );
  act(() =>
    [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === 'Proceed')!
      .click(),
  );
  act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(cancel).toHaveBeenCalledOnce();
});
