import * as api from '@agentctl/api-client';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { RewindConfirmDialog } from './RewindConfirmDialog';

it('keeps the dialog and focus stable while rewinding, then allows dismissal again', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const client = new QueryClient();
  const changeOpen = vi.fn();
  const confirm = vi.fn();
  const render = (loading: boolean) =>
    act(() =>
      root.render(
        <QueryClientProvider client={client}>
          <RewindConfirmDialog
            open
            mode="conversation"
            messageCount={2}
            isLoading={loading}
            onOpenChange={changeOpen}
            onConfirm={confirm}
          />
        </QueryClientProvider>,
      ),
    );
  try {
    render(true);
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-busy')).toBe('true');
    expect(dialog.querySelector('[aria-label="Close dialog"]')).toBeNull();
    expect([...dialog.querySelectorAll('button')].every((button) => button.disabled)).toBe(true);
    await act(async () =>
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    );
    expect(changeOpen).not.toHaveBeenCalled();
    render(false);
    expect(document.querySelector('[role="dialog"]')).toBe(dialog);
    act(() => dialog.querySelector<HTMLButtonElement>('[aria-label="Close dialog"]')!.click());
    expect(changeOpen).toHaveBeenCalledExactlyOnceWith(false);
    expect(confirm).not.toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
    client.clear();
    container.remove();
  }
});

it.each([false, true])(
  'makes unavailable file restoration explicit (request failure=%s)',
  async (failed) => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const preview = vi.spyOn(api, 'previewSnapshotDiff');
    if (failed) preview.mockRejectedValue(new Error('Unavailable'));
    else preview.mockResolvedValue({ hasSnapshot: false, files: [] });
    const confirm = vi.fn();
    try {
      await act(async () =>
        root.render(
          <QueryClientProvider client={client}>
            <RewindConfirmDialog
              open
              mode="files"
              sessionId="session"
              eventId={4}
              messageCount={1}
              onOpenChange={() => {}}
              onConfirm={confirm}
            />
          </QueryClientProvider>,
        ),
      );
      await act(async () => {
        await vi.waitFor(() => expect(client.isFetching()).toBe(0));
      });
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
      const button = [...dialog.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('Rewind & Restore Files'),
      )!;
      expect(button.disabled).toBe(true);
      expect(dialog.textContent).toMatch(/restoration is unavailable|Could not inspect/);
      expect(dialog.textContent).not.toContain('No file changes detected');
      act(() => button.click());
      expect(confirm).not.toHaveBeenCalled();
    } finally {
      act(() => root.unmount());
      client.clear();
      preview.mockRestore();
      container.remove();
    }
  },
);
