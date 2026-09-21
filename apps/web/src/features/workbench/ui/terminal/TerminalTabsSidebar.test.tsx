// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
