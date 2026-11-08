// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test';
import { useTerminalTabsStore } from '../../model/useTerminalTabsStore';
import { TerminalTabsSidebar } from './TerminalTabsSidebar';

describe('TerminalTabsSidebar semantics', () => {
  beforeEach(() => {
    useTerminalTabsStore.setState({ workspaces: {} });
    useTerminalTabsStore.getState().ensureWorkspace('session-a');
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('keeps row selection and row actions as sibling controls', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<TerminalTabsSidebar sessionId="session-a" />);
    });

    const row = container.querySelector('button[aria-label="Terminal 1, connecting"]');
    expect(row).not.toBeNull();
    expect(row?.querySelector('button')).toBeNull();
    expect(container.querySelector('button[aria-label="Split terminal"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Kill terminal"]')).not.toBeNull();

    act(() => root.unmount());
  });
});

function setupNavigation() {
  useTerminalTabsStore.setState({ workspaces: {} });
  const store = useTerminalTabsStore.getState();
  store.ensureWorkspace('session-a');
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(<TerminalTabsSidebar sessionId="session-a" />));
  return { host, root, store };
}
function pressRow(target: Element, key: string) {
  act(() =>
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })),
  );
}
it('navigates terminal rows and split panes using one vertical keyboard sequence', () => {
  const { host, root, store } = setupNavigation();
  act(() => {
    store.splitTab('session-a');
    store.addTab('session-a');
  });
  const buttons = host.querySelectorAll<HTMLButtonElement>('button[aria-pressed]');
  expect(buttons).toHaveLength(3);
  act(() => buttons[0]!.focus());
  pressRow(buttons[0]!, 'ArrowDown');
  const workspace = useTerminalTabsStore.getState().workspaces['session-a']!;
  expect(workspace.activeTabId).toBe(workspace.tabs[0]!.id);
  expect(workspace.tabs[0]!.activePaneId).toBe(workspace.tabs[0]!.panes[1]!.id);
  expect(document.activeElement).toBe(buttons[1]);
  expect(buttons[1]!.getAttribute('aria-pressed')).toBe('true');
  pressRow(buttons[1]!, 'End');
  expect(document.activeElement).toBe(buttons[2]);
  expect(useTerminalTabsStore.getState().workspaces['session-a']!.activeTabId).toBe(
    workspace.tabs[1]!.id,
  );
  pressRow(buttons[2]!, 'ArrowDown');
  expect(document.activeElement).toBe(buttons[0]);
  expect(host.querySelectorAll('[aria-pressed][tabindex="0"]')).toHaveLength(1);
  act(() => root.unmount());
});
it('keeps rename editing and returns focus to the row after saving', () => {
  const { host, root } = setupNavigation();
  const button = host.querySelector<HTMLButtonElement>('button[aria-pressed]')!;
  act(() => {
    button.focus();
    button.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  });
  const input = host.querySelector<HTMLInputElement>('[aria-label="Terminal name"]')!;
  expect(document.activeElement).toBe(input);
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      input,
      'Build shell',
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  pressRow(input, 'Enter');
  expect(useTerminalTabsStore.getState().workspaces['session-a']!.tabs[0]!.name).toBe(
    'Build shell',
  );
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Build shell, connecting');
  act(() => root.unmount());
});
it('keeps row actions independent and restores focus after a terminal is closed', () => {
  const { host, root, store } = setupNavigation();
  act(() => store.addTab('session-a'));
  const rows = host.querySelectorAll<HTMLButtonElement>('button[aria-pressed]');
  const active = rows[1]!;
  const close = active.parentElement!.querySelector<HTMLButtonElement>(
    '[aria-label="Kill terminal"]',
  )!;
  act(() => close.focus());
  pressRow(close, 'Home');
  expect(document.activeElement).toBe(close);
  act(() => close.click());
  expect(useTerminalTabsStore.getState().workspaces['session-a']!.tabs).toHaveLength(1);
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Terminal 1, connecting');
  act(() => root.unmount());
});
