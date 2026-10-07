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
  expect(container.textContent).not.toContain('Queued prompts');
  expect(container.querySelector('[data-queue-layout]')?.getAttribute('data-queue-layout')).toBe(
    'false',
  );
  render([]);
  expect(container.textContent).not.toContain('Queued prompts');
});

test('failed delivery remains visible and can be retried', () => {
  render([{ id: 'failed', text: 'Hello', status: 'failed', error: 'Disconnected' }]);
  expect(container.textContent).toContain('Queued prompts (1)');
  expect(container.querySelector('[data-queue-layout]')?.getAttribute('data-queue-layout')).toBe(
    'true',
  );
  act(() => container.querySelector<HTMLButtonElement>('button[title="Disconnected"]')!.click());
  expect(stream.retryQueuedMessage).toHaveBeenCalledWith('failed');
});

test('waiting prompts keep the correct reorder indices behind an in-flight send', () => {
  render([
    { id: 'sending', text: 'In flight', status: 'sending' },
    { id: 'first', text: 'First waiting', status: 'queued' },
    { id: 'second', text: 'Second waiting', status: 'queued' },
  ]);
  expect(container.textContent).toContain('Queued prompts (2)');
  expect(container.textContent).not.toContain('In flight');
  expect(container.textContent).toContain('#1');
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
