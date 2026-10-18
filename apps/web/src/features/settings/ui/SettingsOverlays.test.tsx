import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test';
import { SettingsOverlays } from './SettingsOverlays';
import { useSettingsOverlayStore } from '../model/useSettingsOverlayStore';

const state = vi.hoisted(() => ({ onboardingCompleted: true, isLoading: false }));
vi.mock('../api/useSettings', () => ({
  useSettings: () => ({
    settings: { onboardingCompleted: state.onboardingCompleted },
    isLoading: state.isLoading,
  }),
}));
vi.mock('./SettingsDialog', () => ({ SettingsDialog: () => <div data-settings="loaded" /> }));
vi.mock('./SetupWizard', () => ({ SetupWizard: () => <div data-onboarding="loaded" /> }));
let root: ReturnType<typeof createRoot>;
let element: HTMLDivElement;
beforeEach(() => {
  state.onboardingCompleted = true;
  state.isLoading = false;
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
    root.render(<SettingsOverlays />);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
it('defers closed settings and completed onboarding; responds to opening and closing', async () => {
  await render();
  expect(element.innerHTML).toBe('');
  await act(async () => {
    useSettingsOverlayStore.getState().openSettings('providers');
  });
  expect(element.querySelector('[data-settings]')).not.toBeNull();
  await act(async () => {
    useSettingsOverlayStore.getState().closeSettings();
  });
  expect(element.innerHTML).toBe('');
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
