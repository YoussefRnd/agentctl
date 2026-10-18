import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test';
import type { SidebarProject } from '@agentctl/api-client';
import { CommandPalette } from './CommandPalette';
import { useCommandPaletteStore } from '../model/useCommandPaletteStore';

const mocks = vi.hoisted(() => ({
  projects: vi.fn(),
  settings: vi.fn(),
  workbench: vi.fn(),
  maximize: vi.fn(),
  theme: vi.fn(),
}));
vi.mock('@/features/projects', () => ({
  projectQueries: { all: () => ({ queryKey: ['palette-projects'], queryFn: mocks.projects }) },
}));
vi.mock('@/features/settings', () => ({
  useSettingsOverlayStore: (
    selector: (state: { openSettings: typeof mocks.settings }) => unknown,
  ) => selector({ openSettings: mocks.settings }),
}));
vi.mock('@/shared/stores/useWorkbenchStore', () => ({
  useWorkbenchStore: (
    selector: (state: {
      toggleWorkbench: typeof mocks.workbench;
      toggleMaximized: typeof mocks.maximize;
    }) => unknown,
  ) => selector({ toggleWorkbench: mocks.workbench, toggleMaximized: mocks.maximize }),
}));
vi.mock('@/shared', () => ({ useTheme: () => ({ themeMode: 'dark', setThemeMode: mocks.theme }) }));

function session(
  id: string,
  title: string,
  status: 'idle' | 'running' | 'needs_attention' | 'error' = 'idle',
): SidebarProject['sessions'][number] {
  return {
    id,
    title,
    taskSlug: id,
    branch: 'feature/search',
    status,
    lastActivityAt: new Date('2026-10-07'),
    updatedAt: new Date('2026-10-07'),
    createdAt: new Date('2026-10-07'),
    mode: 'local',
    worktreePath: '/repo',
    hasUserActivity: true,
  };
}
const projects: SidebarProject[] = [
  {
    id: 'settings',
    name: 'Settings',
    path: '/repo/agentctl',
    isGitRepo: true,
    sessions: [session('settings-review', 'Settings redesign', 'needs_attention')],
  },
  {
    id: 'api',
    name: 'api',
    path: '/repo/api',
    isGitRepo: true,
    sessions: [
      session('api-migration', 'API migration', 'running'),
      session('api-error', 'Investigate failed build', 'error'),
    ],
  },
  { id: 'empty', name: 'Empty workspace', path: '/repo/empty', isGitRepo: false, sessions: [] },
];
let root: Root | undefined;
let client: QueryClient;
function Location() {
  const location = useLocation();
  return (
    <output data-testid="location">
      {location.pathname}
      {location.search}
    </output>
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.projects.mockResolvedValue([]);
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  useCommandPaletteStore.getState().close();
  client?.clear();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

async function renderPalette(data?: SidebarProject[]) {
  const trigger = document.createElement('button');
  trigger.textContent = 'Open palette';
  const container = document.createElement('div');
  document.body.append(trigger, container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  if (data) client.setQueryData(['palette-projects'], data);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <CommandPalette />
          <Location />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
  trigger.focus();
  await act(async () => useCommandPaletteStore.getState().open());
  return {
    trigger,
    dialog: document.querySelector<HTMLElement>('[role="dialog"]')!,
    input: document.querySelector<HTMLInputElement>('[role="combobox"]')!,
  };
}
function options() {
  return [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')];
}
function search(value: string) {
  const input = document.querySelector<HTMLInputElement>('[role="combobox"]')!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function press(target: HTMLElement, key: string, extra: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra });
  act(() => target.dispatchEvent(event));
  return event;
}
function filter(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('[aria-pressed]')].find(
    (button) => button.textContent === label,
  )!;
  act(() => button.click());
  return button;
}

it('focuses search, traps Tab inside the palette, and restores focus on Escape', async () => {
  const { trigger, dialog, input } = await renderPalette([]);
  expect(document.activeElement).toBe(input);
  expect(
    trigger.getAttribute('aria-hidden') ?? trigger.parentElement?.getAttribute('aria-hidden'),
  ).toBe('true');
  const buttons = [...dialog.querySelectorAll<HTMLButtonElement>('button')].filter(
    (button) => button.tabIndex >= 0,
  );
  buttons.at(-1)!.focus();
  press(buttons.at(-1)!, 'Tab');
  expect(document.activeElement).toBe(input);
  press(input, 'Escape');
  await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(useCommandPaletteStore.getState().isOpen).toBe(false);
});

it('uses shared fuzzy matching across names, workspace paths, and categories', async () => {
  await renderPalette(projects);
  search('StG');
  expect(options().some((option) => option.dataset.itemId === 'action-settings-general')).toBe(
    true,
  );
  search('agtctl');
  expect(options().map((option) => option.dataset.itemId)).toEqual(['project-settings']);
  expect(options()[0].querySelectorAll('mark').length).toBeGreaterThan(0);
  search('sessions');
  expect(
    options()
      .slice(0, 3)
      .every((option) => option.dataset.itemId?.startsWith('session-')),
  ).toBe(true);
  filter('Sessions');
  expect(options().length).toBe(3);
});

it('keeps global ranking and keyboard navigation in the same visible order', async () => {
  const { input } = await renderPalette(projects);
  search('api');
  expect(options()[0].dataset.itemId).toBe('project-api');
  expect(options()[0].getAttribute('aria-selected')).toBe('true');
  expect(input.getAttribute('aria-activedescendant')).toBe(options()[0].id);
  press(input, 'ArrowDown');
  expect(options()[1].getAttribute('aria-selected')).toBe('true');
  expect(input.getAttribute('aria-activedescendant')).toBe(options()[1].id);
  press(input, 'ArrowUp');
  expect(options()[0].getAttribute('aria-selected')).toBe('true');
  press(input, 'ArrowUp');
  expect(options().at(-1)?.getAttribute('aria-selected')).toBe('true');
  press(input, 'ArrowDown');
  expect(options()[0].getAttribute('aria-selected')).toBe('true');
});

it('filters categories, keeps typing focus, and resets active selection', async () => {
  const { input } = await renderPalette(projects);
  press(input, 'ArrowDown');
  filter('Workspaces');
  expect(options().map((option) => option.dataset.itemId)).toEqual([
    'project-settings',
    'project-api',
    'project-empty',
  ]);
  expect(options()[0].getAttribute('aria-selected')).toBe('true');
  expect(document.activeElement).toBe(input);
  filter('Actions');
  expect(options().every((option) => option.dataset.itemId?.startsWith('action-'))).toBe(true);
  search('general');
  press(input, 'Enter');
  expect(mocks.settings).toHaveBeenCalledExactlyOnceWith('general');
  expect(useCommandPaletteStore.getState().isOpen).toBe(false);
});

it('does not execute a result when pressing Enter on a filter button', async () => {
  await renderPalette([]);
  const button = [...document.querySelectorAll<HTMLButtonElement>('[aria-pressed]')].at(-1)!;
  button.focus();
  expect(press(button, 'Enter').defaultPrevented).toBe(false);
  expect(useCommandPaletteStore.getState().isOpen).toBe(true);
  expect(mocks.settings).not.toHaveBeenCalled();
});

it('navigates sessions and empty workspaces through the selected results', async () => {
  const { input } = await renderPalette(projects);
  filter('Sessions');
  search('API migration');
  press(input, 'Enter');
  expect(document.querySelector('[data-testid="location"]')?.textContent).toBe(
    '/sessions/api-migration',
  );
  await act(async () => useCommandPaletteStore.getState().open());
  filter('Workspaces');
  search('Empty workspace');
  act(() => options()[0].click());
  expect(document.querySelector('[data-testid="location"]')?.textContent).toBe('/?project=empty');
});

it('shows an empty state and resets the query and filter when reopened', async () => {
  const { input } = await renderPalette(projects);
  filter('Sessions');
  search('zzzzzz');
  expect(options()).toHaveLength(0);
  expect(input.getAttribute('aria-activedescendant')).toBeNull();
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    'No matches for “zzzzzz”',
  );
  press(input, 'Enter');
  expect(useCommandPaletteStore.getState().isOpen).toBe(true);
  press(input, 'Escape');
  await act(async () => useCommandPaletteStore.getState().open());
  expect(document.querySelector<HTMLInputElement>('[role="combobox"]')?.value).toBe('');
  expect(document.querySelector('[aria-pressed="true"]')?.textContent).toBe('All');
});

it('keeps actions usable while workspace data is loading', async () => {
  mocks.projects.mockReturnValue(new Promise(() => {}));
  await renderPalette();
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    'Loading sessions and workspaces',
  );
  expect(options().some((option) => option.dataset.itemId === 'action-settings-general')).toBe(
    true,
  );
  expect(document.querySelector('[role="listbox"]')?.getAttribute('aria-busy')).toBe('true');
});

it('shows workspace load failures and retries without hiding actions', async () => {
  mocks.projects.mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce(projects);
  await renderPalette();
  await vi.waitFor(() =>
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      'Couldn’t load sessions and workspaces',
    ),
  );
  expect(options().some((option) => option.dataset.itemId === 'action-settings-general')).toBe(
    true,
  );
  const retry = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent === 'Retry',
  )!;
  await act(async () => retry.click());
  await vi.waitFor(() =>
    expect(options().some((option) => option.dataset.itemId === 'project-api')).toBe(true),
  );
});

it('preserves session status badges and does not execute during IME composition', async () => {
  const { input } = await renderPalette(projects);
  filter('Sessions');
  expect(
    options().find((option) => option.dataset.itemId === 'session-api-migration')?.textContent,
  ).toContain('Running');
  expect(
    options().find((option) => option.dataset.itemId === 'session-settings-review')?.textContent,
  ).toContain('Needs review');
  expect(
    options().find((option) => option.dataset.itemId === 'session-api-error')?.textContent,
  ).toContain('Error');
  press(input, 'Enter', { isComposing: true });
  expect(useCommandPaletteStore.getState().isOpen).toBe(true);
});
