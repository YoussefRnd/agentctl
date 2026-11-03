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
  vi.clearAllMocks();
});
function render() {
  localStorage.clear();
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

it('preserves the custom theme selector appearance in all three modes', () => {
  render();
  const group = document.querySelector('[aria-label="Theme mode"]')!;
  const result = [];
  for (const mode of ['System', 'Dark', 'Light']) {
    act(() =>
      [...group.querySelectorAll('button')].find((button) => button.textContent === mode)!.click(),
    );
    result.push({
      mode,
      groupClass: group.className,
      buttons: [...group.querySelectorAll('button')].map((button) => ({
        tag: button.tagName,
        className: button.className,
        label: button.textContent,
        iconClass: button.querySelector('svg')?.getAttribute('class'),
      })),
    });
  }
  expect(result).toMatchInlineSnapshot(`
    [
      {
        "buttons": [
          {
            "className": "flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors bg-accent text-brand-crust shadow-sm",
            "iconClass": "lucide lucide-monitor h-3.5 w-3.5",
            "label": "System",
            "tag": "BUTTON",
          },
          {
            "className": "flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors text-text-muted hover:text-text-main hover:bg-surface/60",
            "iconClass": "lucide lucide-moon h-3.5 w-3.5",
            "label": "Dark",
            "tag": "BUTTON",
          },
          {
            "className": "flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors text-text-muted hover:text-text-main hover:bg-surface/60",
            "iconClass": "lucide lucide-sun h-3.5 w-3.5",
            "label": "Light",
            "tag": "BUTTON",
          },
        ],
        "groupClass": "border-border/40 bg-surface/40 flex max-w-full flex-wrap gap-1 rounded-lg border p-1",
        "mode": "System",
      },
      {
        "buttons": [
          {
            "className": "flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors text-text-muted hover:text-text-main hover:bg-surface/60",
            "iconClass": "lucide lucide-monitor h-3.5 w-3.5",
            "label": "System",
            "tag": "BUTTON",
          },
          {
            "className": "flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors bg-accent text-brand-crust shadow-sm",
            "iconClass": "lucide lucide-moon h-3.5 w-3.5",
            "label": "Dark",
            "tag": "BUTTON",
          },
          {
            "className": "flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors text-text-muted hover:text-text-main hover:bg-surface/60",
            "iconClass": "lucide lucide-sun h-3.5 w-3.5",
            "label": "Light",
            "tag": "BUTTON",
          },
        ],
        "groupClass": "border-border/40 bg-surface/40 flex max-w-full flex-wrap gap-1 rounded-lg border p-1",
        "mode": "Dark",
      },
      {
        "buttons": [
          {
            "className": "flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors text-text-muted hover:text-text-main hover:bg-surface/60",
            "iconClass": "lucide lucide-monitor h-3.5 w-3.5",
            "label": "System",
            "tag": "BUTTON",
          },
          {
            "className": "flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors text-text-muted hover:text-text-main hover:bg-surface/60",
            "iconClass": "lucide lucide-moon h-3.5 w-3.5",
            "label": "Dark",
            "tag": "BUTTON",
          },
          {
            "className": "flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors bg-accent text-brand-crust shadow-sm",
            "iconClass": "lucide lucide-sun h-3.5 w-3.5",
            "label": "Light",
            "tag": "BUTTON",
          },
        ],
        "groupClass": "border-border/40 bg-surface/40 flex max-w-full flex-wrap gap-1 rounded-lg border p-1",
        "mode": "Light",
      },
    ]
  `);
});
