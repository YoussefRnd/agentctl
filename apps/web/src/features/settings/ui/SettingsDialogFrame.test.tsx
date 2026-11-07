import { createHash } from 'node:crypto';
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
function appearance(node: Element): unknown {
  return [
    node.tagName,
    node.getAttribute('class'),
    node.getAttribute('style'),
    [...node.children].map(appearance),
  ];
}
it('preserves the settings frame and navigation appearance for each section', () => {
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
  const result = [];
  for (const tab of ['general', 'providers', 'mcp'] as const) {
    act(() => useSettingsOverlayStore.getState().setSettingsTab(tab));
    result.push({
      tab,
      appearance: createHash('sha256')
        .update(JSON.stringify(appearance(document.querySelector('[role="dialog"]')!)))
        .digest('hex'),
    });
  }
  expect(result).toMatchInlineSnapshot(`
    [
      {
        "appearance": "1ce978053b58e203ea1ba560d0406357a1d403c38edf505655a033e21ef01ebf",
        "tab": "general",
      },
      {
        "appearance": "d6d84070ea826e82d5ad3e838b0335f40769662bc730ac67fbdec6035881e94b",
        "tab": "providers",
      },
      {
        "appearance": "d87d8f96224d63f414fae85bac16d15d36f3cd8da849b2e2835f06ce06eff4dd",
        "tab": "mcp",
      },
    ]
  `);
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
