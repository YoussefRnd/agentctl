import { act } from 'react';
import { ThemeProvider } from '@/shared';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test';
import { SettingsOverlays } from './SettingsOverlays';
import { useSettingsOverlayStore } from '../model/useSettingsOverlayStore';

const state = vi.hoisted(() => ({
  onboardingCompleted: true,
  isLoading: false,
  pending: null as Promise<void> | null,
}));
vi.mock('../api/useSettings', () => ({
  useSettings: () => ({
    settings: { onboardingCompleted: state.onboardingCompleted },
    isLoading: state.isLoading,
  }),
}));
vi.mock('./SettingsDialog', () => ({
  SettingsDialogContent: () => {
    const tab = useSettingsOverlayStore((s) => s.settingsTab);
    if (state.pending) throw state.pending;
    return <div data-settings="loaded" data-tab={tab} />;
  },
}));
vi.mock('./SetupWizard', () => ({ SetupWizard: () => <div data-onboarding="loaded" /> }));
let root: ReturnType<typeof createRoot>;
let element: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  state.onboardingCompleted = true;
  state.isLoading = false;
  state.pending = null;
  useSettingsOverlayStore.getState().closeSettings();
  element = document.createElement('div');
  document.body.append(element);
  root = createRoot(element);
});
afterEach(() => {
  act(() => root.unmount());
  element.remove();
  useSettingsOverlayStore.getState().closeSettings();
});
async function render() {
  await act(async () => {
    root.render(
      <ThemeProvider>
        <SettingsOverlays />
      </ThemeProvider>,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
it('defers closed settings and completed onboarding; responds to opening and closing', async () => {
  await render();
  expect(element.innerHTML).toBe('');
  await act(async () => {
    useSettingsOverlayStore.getState().openSettings('providers');
  });
  expect(document.querySelector('[data-settings]')).not.toBeNull();
  await act(async () => {
    useSettingsOverlayStore.getState().closeSettings();
  });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it('waits for settings before loading incomplete onboarding', async () => {
  state.onboardingCompleted = false;
  state.isLoading = true;
  await render();
  expect(element.innerHTML).toBe('');
  state.isLoading = false;
  await render();
  expect(element.querySelector('[data-onboarding]')).not.toBeNull();
  state.onboardingCompleted = true;
  await render();
  expect(element.innerHTML).toBe('');
});

it('keeps the same frame and usable navigation while deferred content loads', async () => {
  const pending = Promise.withResolvers<void>();
  state.pending = pending.promise;
  await render();
  await act(async () => useSettingsOverlayStore.getState().openSettings('general'));
  const frame = document.querySelector('[role="dialog"]');
  const close = document.querySelector<HTMLButtonElement>('[aria-label="Close settings"]');
  expect(frame).not.toBeNull();
  expect(close).not.toBeNull();
  expect(document.querySelector('[role="status"] .sr-only')?.textContent).toBe('Loading settings…');
  const providers = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
    (tab) => tab.textContent === 'AI Providers',
  )!;
  act(() => providers.click());
  expect(providers.getAttribute('aria-selected')).toBe('true');
  await act(async () => {
    state.pending = null;
    pending.resolve();
    await pending.promise;
  });
  expect(document.querySelector('[role="dialog"]')).toBe(frame);
  expect(document.querySelector('[aria-label="Close settings"]')).toBe(close);
  expect(document.querySelector('[role="status"]')).toBeNull();
  expect(document.querySelector('[data-settings]')?.getAttribute('data-tab')).toBe('providers');
});

it('allows closing pending content and does not reopen when loading finishes', async () => {
  const pending = Promise.withResolvers<void>();
  state.pending = pending.promise;
  await render();
  await act(async () => useSettingsOverlayStore.getState().openSettings('mcp'));
  act(() => document.querySelector<HTMLButtonElement>('[aria-label="Close settings"]')!.click());
  expect(useSettingsOverlayStore.getState().isSettingsOpen).toBe(false);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => {
    state.pending = null;
    pending.resolve();
    await pending.promise;
  });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it('renders the selected settings layout while pending and keeps placeholder controls inert', async () => {
  const pending = Promise.withResolvers<void>();
  state.pending = pending.promise;
  localStorage.setItem('agentctl-ui-theme-mode', 'dark');
  await render();
  await act(async () => useSettingsOverlayStore.getState().openSettings('general'));
  const headings = () =>
    [...document.querySelectorAll('[role="dialog"] h2, [role="dialog"] h3')].map(
      (node) => node.textContent,
    );
  expect(headings()).toContain('General Settings');
  expect(document.querySelector('[inert][aria-hidden="true"]')).not.toBeNull();
  const pendingBody = document.querySelector('[inert][aria-hidden="true"]')!;
  expect(pendingBody.querySelector('[role="switch"]')).not.toBeNull();
  expect(pendingBody.querySelector('input')).not.toBeNull();
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Dark Theme');
  expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain('Light Theme');
  await act(async () => useSettingsOverlayStore.getState().setSettingsTab('mcp'));
  expect(headings()).toContain('MCP Servers');
  expect(headings()).not.toContain('General Settings');
  await act(async () => useSettingsOverlayStore.getState().setSettingsTab('providers'));
  expect(headings()).toContain('AI Providers');
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Provider profiles');
  expect(document.querySelectorAll('[role="dialog"] [role="status"]')).toHaveLength(1);
  await act(async () => {
    useSettingsOverlayStore.getState().closeSettings();
    state.pending = null;
    pending.resolve();
    await pending.promise;
  });
});
