import { create } from 'zustand';

export interface TerminalPaneData {
  id: string;
  name: string;
  shell: string;
  status: 'connecting' | 'connected' | 'disconnected';
}

export interface TerminalTabData {
  id: string;
  name: string;
  panes: TerminalPaneData[];
  activePaneId: string;
  splitOrientation: 'horizontal' | 'vertical';
}

export interface TerminalWorkspaceState {
  tabs: TerminalTabData[];
  activeTabId: string;
  isSidebarOpen: boolean;
  nextTabNumber: number;
  nextPaneNumber: number;
}

export interface TerminalTabsState {
  workspaces: Record<string, TerminalWorkspaceState>;
  ensureWorkspace: (sessionId: string) => void;
  resetWorkspace: (sessionId: string) => void;
  addTab: (sessionId: string, customName?: string) => string;
  closeTab: (sessionId: string, tabId: string) => void;
  setActiveTab: (sessionId: string, tabId: string) => void;
  renameTab: (sessionId: string, tabId: string, name: string) => void;
  splitTab: (sessionId: string, tabId?: string, orientation?: 'horizontal' | 'vertical') => string;
  closePane: (sessionId: string, tabId: string, paneId: string) => void;
  setActivePane: (sessionId: string, tabId: string, paneId: string) => void;
  renamePane: (sessionId: string, tabId: string, paneId: string, name: string) => void;
  setPaneShell: (sessionId: string, paneId: string, shell: string) => void;
  setPaneStatus: (
    sessionId: string,
    paneId: string,
    status: 'connecting' | 'connected' | 'disconnected',
  ) => void;
  toggleSplitOrientation: (sessionId: string, tabId?: string) => void;
  toggleSidebar: (sessionId: string) => void;
  setSidebarOpen: (sessionId: string, open: boolean) => void;
}

export function createInitialTerminalWorkspace(sessionId: string): TerminalWorkspaceState {
  const tabId = `tab-${sessionId}-1`;
  const paneId = `term-${sessionId}-1`;
  return {
    tabs: [
      {
        id: tabId,
        name: 'Terminal 1',
        panes: [
          {
            id: paneId,
            name: 'Terminal 1',
            shell: 'sh',
            status: 'connecting',
          },
        ],
        activePaneId: paneId,
        splitOrientation: 'horizontal',
      },
    ],
    activeTabId: tabId,
    isSidebarOpen: true,
    nextTabNumber: 2,
    nextPaneNumber: 2,
  };
}

function workspaceFor(state: TerminalTabsState, sessionId: string): TerminalWorkspaceState {
  return state.workspaces[sessionId] ?? createInitialTerminalWorkspace(sessionId);
}

function replaceWorkspace(
  state: TerminalTabsState,
  sessionId: string,
  workspace: TerminalWorkspaceState,
) {
  return { workspaces: { ...state.workspaces, [sessionId]: workspace } };
}

export const useTerminalTabsStore = create<TerminalTabsState>((set, get) => ({
  workspaces: {},

  ensureWorkspace: (sessionId) => {
    if (!sessionId || get().workspaces[sessionId]) return;
    set((state) => replaceWorkspace(state, sessionId, createInitialTerminalWorkspace(sessionId)));
  },

  resetWorkspace: (sessionId) => {
    set((state) => replaceWorkspace(state, sessionId, createInitialTerminalWorkspace(sessionId)));
  },

  addTab: (sessionId, customName) => {
    const workspace = workspaceFor(get(), sessionId);
    const tabNumber = workspace.nextTabNumber;
    const paneNumber = workspace.nextPaneNumber;
    const timestamp = Date.now();
    const tabId = `tab-${sessionId}-${timestamp}-${tabNumber}`;
    const paneId = `term-${sessionId}-${timestamp}-${paneNumber}`;
    const tabName = customName || `Terminal ${tabNumber}`;
    const newTab: TerminalTabData = {
      id: tabId,
      name: tabName,
      panes: [{ id: paneId, name: tabName, shell: 'sh', status: 'connecting' }],
      activePaneId: paneId,
      splitOrientation: 'horizontal',
    };

    set((state) => {
      const workspace = workspaceFor(state, sessionId);
      return replaceWorkspace(state, sessionId, {
        ...workspace,
        tabs: [...workspace.tabs, newTab],
        activeTabId: tabId,
        nextTabNumber: tabNumber + 1,
        nextPaneNumber: paneNumber + 1,
      });
    });
    return tabId;
  },

  closeTab: (sessionId, tabId) => {
    set((state) => {
      const workspace = workspaceFor(state, sessionId);
      const remainingTabs = workspace.tabs.filter((tab) => tab.id !== tabId);
      if (remainingTabs.length === 0) {
        return replaceWorkspace(state, sessionId, createInitialTerminalWorkspace(sessionId));
      }

      let nextActiveId = workspace.activeTabId;
      if (workspace.activeTabId === tabId) {
        const closedIndex = workspace.tabs.findIndex((tab) => tab.id === tabId);
        nextActiveId =
          remainingTabs[closedIndex]?.id ??
          remainingTabs[closedIndex - 1]?.id ??
          remainingTabs[0]!.id;
      }
      return replaceWorkspace(state, sessionId, {
        ...workspace,
        tabs: remainingTabs,
        activeTabId: nextActiveId,
      });
    });
  },

  setActiveTab: (sessionId, tabId) => {
    set((state) => {
      const workspace = workspaceFor(state, sessionId);
      return replaceWorkspace(state, sessionId, { ...workspace, activeTabId: tabId });
    });
  },

  renameTab: (sessionId, tabId, name) => {
    set((state) => {
      const workspace = workspaceFor(state, sessionId);
      return replaceWorkspace(state, sessionId, {
        ...workspace,
        tabs: workspace.tabs.map((tab) =>
          tab.id === tabId
            ? {
                ...tab,
                name,
                panes: tab.panes.length === 1 ? [{ ...tab.panes[0]!, name }] : tab.panes,
              }
            : tab,
        ),
      });
    });
  },

  splitTab: (sessionId, targetTabId, orientation) => {
    const workspace = workspaceFor(get(), sessionId);
    const tabId = targetTabId || workspace.activeTabId;
    const paneNumber = workspace.nextPaneNumber;
    const newPaneId = `term-${sessionId}-${Date.now()}-${paneNumber}`;
    set((state) => {
      const currentWorkspace = workspaceFor(state, sessionId);
      return replaceWorkspace(state, sessionId, {
        ...currentWorkspace,
        activeTabId: tabId,
        nextPaneNumber: paneNumber + 1,
        tabs: currentWorkspace.tabs.map((tab) =>
          tab.id === tabId
            ? {
                ...tab,
                panes: [
                  ...tab.panes,
                  {
                    id: newPaneId,
                    name: tab.panes[0]?.shell || 'zsh',
                    shell: 'sh',
                    status: 'connecting' as const,
                  },
                ],
                activePaneId: newPaneId,
                splitOrientation: orientation ?? tab.splitOrientation,
              }
            : tab,
        ),
      });
    });
    return newPaneId;
  },

  closePane: (sessionId, tabId, paneId) => {
    const workspace = workspaceFor(get(), sessionId);
    const targetTab = workspace.tabs.find((tab) => tab.id === tabId);
    if (!targetTab) return;
    if (targetTab.panes.length <= 1) {
      get().closeTab(sessionId, tabId);
      return;
    }

    set((state) => {
      const currentWorkspace = workspaceFor(state, sessionId);
      return replaceWorkspace(state, sessionId, {
        ...currentWorkspace,
        tabs: currentWorkspace.tabs.map((tab) => {
          if (tab.id !== tabId) return tab;
          const remainingPanes = tab.panes.filter((pane) => pane.id !== paneId);
          let nextActivePaneId = tab.activePaneId;
          if (tab.activePaneId === paneId) {
            const closedIndex = tab.panes.findIndex((pane) => pane.id === paneId);
            nextActivePaneId =
              remainingPanes[closedIndex]?.id ??
              remainingPanes[closedIndex - 1]?.id ??
              remainingPanes[0]!.id;
          }
          return { ...tab, panes: remainingPanes, activePaneId: nextActivePaneId };
        }),
      });
    });
  },

  setActivePane: (sessionId, tabId, paneId) => {
    set((state) => {
      const workspace = workspaceFor(state, sessionId);
      return replaceWorkspace(state, sessionId, {
        ...workspace,
        activeTabId: tabId,
        tabs: workspace.tabs.map((tab) =>
          tab.id === tabId ? { ...tab, activePaneId: paneId } : tab,
        ),
      });
    });
  },

  renamePane: (sessionId, tabId, paneId, name) => {
    set((state) => {
      const workspace = workspaceFor(state, sessionId);
      return replaceWorkspace(state, sessionId, {
        ...workspace,
        tabs: workspace.tabs.map((tab) =>
          tab.id === tabId
            ? {
                ...tab,
                panes: tab.panes.map((pane) => (pane.id === paneId ? { ...pane, name } : pane)),
              }
            : tab,
        ),
      });
    });
  },

  setPaneShell: (sessionId, paneId, shell) => {
    set((state) => {
      const workspace = workspaceFor(state, sessionId);
      return replaceWorkspace(state, sessionId, {
        ...workspace,
        tabs: workspace.tabs.map((tab) => ({
          ...tab,
          panes: tab.panes.map((pane) => {
            if (pane.id !== paneId) return pane;
            const isGeneric = !pane.name || pane.name.startsWith('Terminal') || pane.name === 'sh';
            return { ...pane, shell, name: isGeneric ? shell : pane.name };
          }),
        })),
      });
    });
  },

  setPaneStatus: (sessionId, paneId, status) => {
    set((state) => {
      const workspace = workspaceFor(state, sessionId);
      return replaceWorkspace(state, sessionId, {
        ...workspace,
        tabs: workspace.tabs.map((tab) => ({
          ...tab,
          panes: tab.panes.map((pane) => (pane.id === paneId ? { ...pane, status } : pane)),
        })),
      });
    });
  },

  toggleSplitOrientation: (sessionId, targetTabId) => {
    set((state) => {
      const workspace = workspaceFor(state, sessionId);
      const tabId = targetTabId || workspace.activeTabId;
      return replaceWorkspace(state, sessionId, {
        ...workspace,
        tabs: workspace.tabs.map((tab) =>
          tab.id === tabId
            ? {
                ...tab,
                splitOrientation: tab.splitOrientation === 'horizontal' ? 'vertical' : 'horizontal',
              }
            : tab,
        ),
      });
    });
  },

  toggleSidebar: (sessionId) => {
    set((state) => {
      const workspace = workspaceFor(state, sessionId);
      return replaceWorkspace(state, sessionId, {
        ...workspace,
        isSidebarOpen: !workspace.isSidebarOpen,
      });
    });
  },

  setSidebarOpen: (sessionId, open) => {
    set((state) => {
      const workspace = workspaceFor(state, sessionId);
      return replaceWorkspace(state, sessionId, { ...workspace, isSidebarOpen: open });
    });
  },
}));
