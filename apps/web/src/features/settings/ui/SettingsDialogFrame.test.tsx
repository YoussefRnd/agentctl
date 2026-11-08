import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it } from 'vite-plus/test';
import { SettingsDialogFrame } from './SettingsDialogFrame';
import { useSettingsOverlayStore } from '../model/useSettingsOverlayStore';
let root: Root;
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = '';
  useSettingsOverlayStore.getState().closeSettings();
});
it('shares responsive keyboard selection and links the active settings panel', () => {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  useSettingsOverlayStore.getState().openSettings('general');
  act(() =>
    root.render(
      <SettingsDialogFrame>
        <p>Settings body</p>
      </SettingsDialogFrame>,
    ),
  );
  const list = document.querySelector<HTMLElement>('[aria-label="Settings sections"]')!;
  act(() => {
    list.style.flexDirection = 'column';
    window.dispatchEvent(new Event('resize'));
  });
  const tabs = list.querySelectorAll<HTMLButtonElement>('[role="tab"]');
  act(() => {
    tabs[0]!.focus();
    tabs[0]!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
    );
  });
  expect(document.activeElement).toBe(tabs[1]);
  expect(useSettingsOverlayStore.getState().settingsTab).toBe('providers');
  const panel = document.getElementById(tabs[1]!.getAttribute('aria-controls')!)!;
  expect(panel.getAttribute('role')).toBe('tabpanel');
  expect(panel.getAttribute('aria-labelledby')).toBe(tabs[1]!.id);
  act(() =>
    tabs[1]!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }),
    ),
  );
  expect(document.activeElement).toBe(tabs[2]);
  expect(useSettingsOverlayStore.getState().settingsTab).toBe('mcp');
  act(() => {
    list.style.flexDirection = 'row';
    window.dispatchEvent(new Event('resize'));
    tabs[2]!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
    );
  });
  expect(document.activeElement).toBe(tabs[0]);
  expect(useSettingsOverlayStore.getState().settingsTab).toBe('general');
});
