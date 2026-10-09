import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { QueuedMessage } from '@/shared/stores/useMessageQueueStore';
import { CommandBar } from './CommandBar';

const stream = vi.hoisted(() => ({
  queuedMessages: [] as QueuedMessage[],
  dequeueMessage: vi.fn(),
  moveQueuedMessage: vi.fn(),
  retryQueuedMessage: vi.fn(),
  editQueuedMessage: vi.fn().mockResolvedValue(true),
}));
vi.mock('@/features/sessions', () => ({ useSessionQueue: () => stream }));
vi.mock('../model/useCommandBarState', () => ({ useCommandBarState: () => ({}) }));
vi.mock('./ComposerInput', () => ({
  ComposerInput: ({ hasQueuedMessages }: { hasQueuedMessages: boolean }) => (
    <div data-queue-layout={String(hasQueuedMessages)} />
  ),
}));
vi.mock('./CommandBarToolbar', () => ({ CommandBarToolbar: () => null }));
vi.mock('./WorkspaceStateReviewer', () => ({ CommandBarFooter: () => null }));
vi.mock('./SessionController', () => ({ ApprovalModeSelector: () => null }));
vi.mock('@/features/providers', () => ({ ProviderAuthDialog: () => null }));

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
function render(messages: QueuedMessage[]) {
  stream.queuedMessages = messages;
  act(() => root.render(<CommandBar onSend={vi.fn()} />));
}
beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));

test('an immediate send never opens the queue or changes the composer layout', () => {
  render([]);
  render([{ id: 'immediate', text: 'Hello', status: 'sending' }]);
  expect(container.querySelector('[aria-label="Message queue"]')).toBeNull();
  expect(container.querySelector('[data-queue-layout]')?.getAttribute('data-queue-layout')).toBe(
    'false',
  );
  render([]);
  expect(container.querySelector('[aria-label="Message queue"]')).toBeNull();
});

test('failed delivery remains visible and can be retried', () => {
  render([{ id: 'failed', text: 'Hello', status: 'failed', error: 'Disconnected' }]);
  expect(container.querySelector('[aria-label="Message queue"]')).not.toBeNull();
  expect(container.querySelector('[data-queue-layout]')?.getAttribute('data-queue-layout')).toBe(
    'true',
  );
  act(() =>
    container.querySelector<HTMLButtonElement>('[aria-label="Retry queued message"]')!.click(),
  );
  expect(stream.retryQueuedMessage).toHaveBeenCalledWith('failed');
});

test('summarizes failed outbox errors without leaking raw diagnostics through text or tooltips', () => {
  render([
    {
      id: 'failed',
      text: 'Hello',
      status: 'failed',
      error: 'Authentication required\nAgent stderr: Bearer private-token ' + 'x'.repeat(5000),
    },
  ]);
  expect(container.textContent).toContain('Sign in again or check your subscription');
  expect(container.innerHTML).not.toMatch(/Agent stderr|private-token|x{100}/);
});

test('waiting prompts keep the correct reorder indices behind an in-flight send', () => {
  render([
    { id: 'sending', text: 'In flight', status: 'sending' },
    { id: 'first', text: 'First waiting', status: 'queued' },
    { id: 'second', text: 'Second waiting', status: 'queued' },
  ]);
  expect(container.querySelectorAll('li')).toHaveLength(2);
  expect(container.textContent).not.toContain('In flight');
  expect(container.textContent).toContain('First waiting');
  const upButtons = container.querySelectorAll<HTMLButtonElement>(
    '[aria-label="Move up in queue"]',
  );
  expect(upButtons[0].disabled).toBe(true);
  act(() => upButtons[1].click());
  expect(stream.moveQueuedMessage).toHaveBeenCalledWith(2, 'up');
  act(() =>
    container.querySelector<HTMLButtonElement>('[aria-label="Move down in queue"]')!.click(),
  );
  expect(stream.moveQueuedMessage).toHaveBeenCalledWith(1, 'down');
  act(() => container.querySelector<HTMLButtonElement>('[aria-label="Cancel prompt"]')!.click());
  expect(stream.dequeueMessage).toHaveBeenCalledWith('first');
});

test('shows a waiting acceptance request and prevents crossing server/outbox boundaries', () => {
  render([
    { id: 'server', text: 'Accepted', status: 'queued', accepted: true },
    { id: 'in-flight', text: 'Adding follow-up', status: 'sending', waiting: true },
    { id: 'local', text: 'Waiting locally', status: 'queued' },
  ]);
  expect(container.textContent).toContain('Adding follow-up');
  expect(container.querySelectorAll('[aria-label="Move up in queue"]')).toHaveLength(3);
  expect(
    [...container.querySelectorAll<HTMLButtonElement>('[aria-label="Move up in queue"]')].every(
      (button) => button.disabled,
    ),
  ).toBe(true);
  expect(
    [...container.querySelectorAll<HTMLButtonElement>('[aria-label="Move down in queue"]')].every(
      (button) => button.disabled,
    ),
  ).toBe(true);
});

test('collapses the list and edits queued messages without removing them', async () => {
  render([{ id: 'first', text: 'Original', status: 'queued', accepted: true }]);
  act(() =>
    container.querySelector<HTMLButtonElement>('[aria-label="Collapse message queue"]')!.click(),
  );
  expect(container.querySelector('ol')).toBeNull();
  act(() =>
    container.querySelector<HTMLButtonElement>('[aria-label="Expand message queue"]')!.click(),
  );
  act(() =>
    container.querySelector<HTMLButtonElement>('[aria-label="Edit queued message"]')!.click(),
  );
  const textarea = container.querySelector('textarea')!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
      textarea,
      'Changed',
    );
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () =>
    [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === 'Save')!
      .click(),
  );
  expect(stream.editQueuedMessage).toHaveBeenCalledWith('first', 'Changed');
  expect(stream.dequeueMessage).not.toHaveBeenCalled();
});

test('preserves an unsaved draft if the message leaves the queue while editing', async () => {
  render([{ id: 'first', text: 'Original', status: 'queued', accepted: true }]);
  act(() =>
    container.querySelector<HTMLButtonElement>('[aria-label="Edit queued message"]')!.click(),
  );
  const textarea = container.querySelector('textarea')!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
      textarea,
      'Unsaved draft',
    );
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
  render([]);
  expect(container.querySelector('textarea')).toBe(textarea);
  expect(textarea.value).toBe('Unsaved draft');
  expect(container.textContent).toContain('This message is no longer queued');
  await act(async () =>
    [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === 'Save')!
      .click(),
  );
  expect(stream.editQueuedMessage).not.toHaveBeenCalled();
  expect(textarea.value).toBe('Unsaved draft');
});
