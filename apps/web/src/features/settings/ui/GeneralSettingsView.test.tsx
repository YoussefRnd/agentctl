import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vite-plus/test';
import { ThemeProvider } from '@/shared';
import { UpdateProvider } from '@/features/updates';
import { GeneralSettingsView } from './GeneralSettingsView';

const updateSettings = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('../api/useSettings', () => ({
  useSettings: () => ({
    settings: { showThinking: false, defaultToWorktree: true },
    updateSettings,
    isLoading: false,
    isUpdating: false,
  }),
}));
vi.mock('@/features/providers', () => ({
  useProviders: () => ({ providers: [], isLoadingProviders: false }),
}));
let root: Root;
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = '';
  localStorage.clear();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
function render() {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root.render(
      <ThemeProvider>
        <UpdateProvider>
          <GeneralSettingsView />
        </UpdateProvider>
      </ThemeProvider>,
    ),
  );
}
function switchIn(label: string) {
  const text = [...document.querySelectorAll('p')].find((node) => node.textContent === label)!;
  return text.parentElement!.parentElement!.querySelector<HTMLButtonElement>('[role="switch"]')!;
}
it('retains working settings controls when they are passed through shared layout slots', async () => {
  render();
  await act(async () => switchIn('Auto-Expand Thinking').click());
  expect(updateSettings).toHaveBeenCalledWith({ showThinking: true });
  await act(async () => switchIn('Use Git Worktrees by Default').click());
  expect(updateSettings).toHaveBeenCalledWith({ defaultToWorktree: false });
  expect(document.querySelectorAll('[data-font-ctx]')).toHaveLength(2);
  expect(document.body.textContent).toContain('Git text generation');
});
it('uses the real theme mode to select the matching appearance rows', () => {
  render();
  act(() =>
    [...document.querySelectorAll<HTMLButtonElement>('[aria-pressed]')]
      .find((button) => button.textContent === 'Light')!
      .click(),
  );
  expect(document.body.textContent).toContain('Light Theme');
  expect(document.body.textContent).not.toContain('Dark Theme');
  act(() =>
    [...document.querySelectorAll<HTMLButtonElement>('[aria-pressed]')]
      .find((button) => button.textContent === 'Dark')!
      .click(),
  );
  expect(document.body.textContent).toContain('Dark Theme');
  expect(document.body.textContent).not.toContain('Light Theme');
});

it('migrates the legacy dark theme and persists changes to the selected mode', () => {
  localStorage.setItem('agentctl-ui-theme', 'oled-glass');
  render();
  const group = document.querySelector('[aria-label="Theme mode"]')!;
  expect(group.querySelector('[aria-pressed="true"]')?.textContent).toBe('Dark');
  expect(document.documentElement.dataset.theme).toBe('mocha');

  const system = [...group.querySelectorAll('button')].find(
    (button) => button.textContent === 'System',
  )!;
  act(() => system.click());
  expect(group.querySelector('[aria-pressed="true"]')).toBe(system);
  expect(document.documentElement.dataset.theme).toBe('latte');
  expect(localStorage.getItem('agentctl-ui-theme-mode')).toBe('system');
});

it('applies a theme even when browser storage cannot be written', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('Storage unavailable', 'QuotaExceededError');
  });
  render();
  const group = document.querySelector('[aria-label="Theme mode"]')!;
  const dark = [...group.querySelectorAll('button')].find(
    (button) => button.textContent === 'Dark',
  )!;
  act(() => dark.click());
  expect(group.querySelector('[aria-pressed="true"]')).toBe(dark);
  expect(document.documentElement.dataset.theme).toBe('mocha');
});
