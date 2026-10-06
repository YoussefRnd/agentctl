import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { CommandPalette } from './CommandPalette';
import { useCommandPaletteStore } from '../model/useCommandPaletteStore';

vi.mock('@/features/projects', () => ({
  projectQueries: { all: () => ({ queryKey: ['palette-projects'], queryFn: async () => [] }) },
}));
vi.mock('@/features/settings', () => ({
  useSettingsOverlayStore: (selector: (state: { openSettings: () => void }) => unknown) =>
    selector({ openSettings: vi.fn() }),
}));
vi.mock('@/features/workbench', () => ({
  useWorkbenchStore: (
    selector: (state: { toggleWorkbench: () => void; toggleMaximized: () => void }) => unknown,
  ) => selector({ toggleWorkbench: vi.fn(), toggleMaximized: vi.fn() }),
}));
vi.mock('@/shared', () => ({
  useTheme: () => ({ themeMode: 'dark', setThemeMode: vi.fn() }),
}));

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  useCommandPaletteStore.getState().close();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

it('focuses search, traps Tab inside the palette, and restores focus on Escape', async () => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  const trigger = document.createElement('button');
  trigger.textContent = 'Open palette';
  const container = document.createElement('div');
  document.body.append(trigger, container);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  root = createRoot(container);
  await act(async () =>
    root!.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <CommandPalette />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
  trigger.focus();
  await act(async () => useCommandPaletteStore.getState().open());
  const dialog = document.querySelector('[role="dialog"]')!;
  const input = dialog.querySelector('input')!;
  expect(document.activeElement).toBe(input);
  expect(
    trigger.getAttribute('aria-hidden') ?? trigger.parentElement?.getAttribute('aria-hidden'),
  ).toBe('true');
  const buttons = [...dialog.querySelectorAll('button')];
  buttons.at(-1)!.focus();
  await act(async () =>
    buttons.at(-1)!.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(document.activeElement).toBe(input);
  await act(async () =>
    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(useCommandPaletteStore.getState().isOpen).toBe(false);
  queryClient.clear();
});
