import { beforeEach, describe, expect, it } from 'vite-plus/test';
import { useTerminalTabsStore } from './useTerminalTabsStore';

describe('useTerminalTabsStore', () => {
  beforeEach(() => {
    useTerminalTabsStore.setState({ workspaces: {} });
  });

  it('keeps terminal tabs and splits scoped to their session', () => {
    const store = useTerminalTabsStore.getState();
    store.ensureWorkspace('session-a');
    store.ensureWorkspace('session-b');

    const sessionATab = useTerminalTabsStore.getState().workspaces['session-a']!.activeTabId;
    store.renameTab('session-a', sessionATab, 'API server');
    store.splitTab('session-a', sessionATab, 'vertical');
    store.addTab('session-a', 'Tests');
    store.addTab('session-b');

    const { workspaces } = useTerminalTabsStore.getState();
    expect(workspaces['session-a']?.tabs).toHaveLength(2);
    expect(workspaces['session-a']?.tabs[0]?.name).toBe('API server');
    expect(workspaces['session-a']?.tabs[0]?.panes).toHaveLength(2);
    expect(workspaces['session-b']?.tabs).toHaveLength(2);
    expect(workspaces['session-b']?.tabs[0]?.name).toBe('Terminal 1');
    expect(workspaces['session-b']?.tabs[0]?.panes).toHaveLength(1);
    expect(workspaces['session-b']?.tabs[1]?.name).toBe('Terminal 2');
  });
});
