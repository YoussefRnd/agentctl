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

export interface TerminalTabsState {
  tabs: TerminalTabData[];
  activeTabId: string;
  isSidebarOpen: boolean;

  // Tab management
  addTab: (customName?: string) => string;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  renameTab: (tabId: string, name: string) => void;

  // Split pane management
  splitTab: (tabId?: string, orientation?: 'horizontal' | 'vertical') => string;
  closePane: (tabId: string, paneId: string) => void;
  setActivePane: (tabId: string, paneId: string) => void;
  renamePane: (tabId: string, paneId: string, name: string) => void;
  setPaneShell: (paneId: string, shell: string) => void;
  setPaneStatus: (paneId: string, status: 'connecting' | 'connected' | 'disconnected') => void;
  toggleSplitOrientation: (tabId?: string) => void;

  // Sidebar toggle
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
}

let nextTabCounter = 2;
let nextPaneCounter = 2;

export const useTerminalTabsStore = create<TerminalTabsState>((set, get) => ({
  tabs: [
    {
      id: 'tab-1',
      name: 'Terminal 1',
      panes: [
        {
          id: 'term-1',
          name: 'Terminal 1',
          shell: 'sh',
          status: 'connecting',
        },
      ],
      activePaneId: 'term-1',
      splitOrientation: 'horizontal',
    },
  ],
  activeTabId: 'tab-1',
  isSidebarOpen: true,

  addTab: (customName) => {
    const tabNum = nextTabCounter++;
    const tabId = `tab-${Date.now()}`;
    const paneId = `term-${Date.now()}-${nextPaneCounter++}`;
    const tabName = customName || `Terminal ${tabNum}`;

    const newTab: TerminalTabData = {
      id: tabId,
      name: tabName,
      panes: [
        {
          id: paneId,
          name: tabName,
          shell: 'sh',
          status: 'connecting',
        },
      ],
      activePaneId: paneId,
      splitOrientation: 'horizontal',
    };

    set((state) => ({
      tabs: [...state.tabs, newTab],
      activeTabId: tabId,
    }));

    return tabId;
  },

  closeTab: (tabId) => {
    set((state) => {
      const remainingTabs = state.tabs.filter((t) => t.id !== tabId);

      // If all tabs are closed, create a fresh terminal tab like VS Code does
      if (remainingTabs.length === 0) {
        const freshTabNum = 1;
        const freshTabId = `tab-${Date.now()}`;
        const freshPaneId = `term-${Date.now()}`;
        const freshTab: TerminalTabData = {
          id: freshTabId,
          name: `Terminal ${freshTabNum}`,
          panes: [
            {
              id: freshPaneId,
              name: `Terminal ${freshTabNum}`,
              shell: 'sh',
              status: 'connecting',
            },
          ],
          activePaneId: freshPaneId,
          splitOrientation: 'horizontal',
        };
        return {
          tabs: [freshTab],
          activeTabId: freshTabId,
        };
      }

      let nextActiveId = state.activeTabId;
      if (state.activeTabId === tabId) {
        const closedIdx = state.tabs.findIndex((t) => t.id === tabId);
        nextActiveId =
          remainingTabs[closedIdx]?.id ?? remainingTabs[closedIdx - 1]?.id ?? remainingTabs[0]!.id;
      }

      return {
        tabs: remainingTabs,
        activeTabId: nextActiveId,
      };
    });
  },

  setActiveTab: (tabId) => {
    set({ activeTabId: tabId });
  },

  renameTab: (tabId, name) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId
          ? {
              ...t,
              name,
              panes: t.panes.length === 1 ? [{ ...t.panes[0]!, name }] : t.panes,
            }
          : t,
      ),
    }));
  },

  splitTab: (targetTabId, orientation) => {
    const tabId = targetTabId || get().activeTabId;
    const newPaneId = `term-${Date.now()}-${nextPaneCounter++}`;

    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== tabId) return tab;
        const newPaneName = tab.panes[0]?.shell || 'zsh';
        const updatedPanes = [
          ...tab.panes,
          {
            id: newPaneId,
            name: newPaneName,
            shell: 'sh',
            status: 'connecting' as const,
          },
        ];
        return {
          ...tab,
          panes: updatedPanes,
          activePaneId: newPaneId,
          splitOrientation: orientation ?? tab.splitOrientation,
        };
      }),
      activeTabId: tabId,
    }));

    return newPaneId;
  },

  closePane: (tabId, paneId) => {
    const state = get();
    const targetTab = state.tabs.find((t) => t.id === tabId);
    if (!targetTab) return;

    if (targetTab.panes.length <= 1) {
      // Last pane in this tab, close the entire tab
      state.closeTab(tabId);
      return;
    }

    set((s) => ({
      tabs: s.tabs.map((tab) => {
        if (tab.id !== tabId) return tab;
        const remainingPanes = tab.panes.filter((p) => p.id !== paneId);
        let nextActivePaneId = tab.activePaneId;
        if (tab.activePaneId === paneId) {
          const closedIdx = tab.panes.findIndex((p) => p.id === paneId);
          nextActivePaneId =
            remainingPanes[closedIdx]?.id ??
            remainingPanes[closedIdx - 1]?.id ??
            remainingPanes[0]!.id;
        }
        return {
          ...tab,
          panes: remainingPanes,
          activePaneId: nextActivePaneId,
        };
      }),
    }));
  },

  setActivePane: (tabId, paneId) => {
    set((state) => ({
      activeTabId: tabId,
      tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, activePaneId: paneId } : t)),
    }));
  },

  renamePane: (tabId, paneId, name) => {
    set((state) => ({
      tabs: state.tabs.map((t) => {
        if (t.id !== tabId) return t;
        return {
          ...t,
          panes: t.panes.map((p) => (p.id === paneId ? { ...p, name } : p)),
        };
      }),
    }));
  },

  setPaneShell: (paneId, shell) => {
    set((state) => ({
      tabs: state.tabs.map((t) => ({
        ...t,
        panes: t.panes.map((p) => {
          if (p.id !== paneId) return p;
          const isGeneric = !p.name || p.name.startsWith('Terminal') || p.name === 'sh';
          return {
            ...p,
            shell,
            name: isGeneric ? shell : p.name,
          };
        }),
      })),
    }));
  },

  setPaneStatus: (paneId, status) => {
    set((state) => ({
      tabs: state.tabs.map((t) => ({
        ...t,
        panes: t.panes.map((p) => (p.id === paneId ? { ...p, status } : p)),
      })),
    }));
  },

  toggleSplitOrientation: (targetTabId) => {
    const tabId = targetTabId || get().activeTabId;
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId
          ? {
              ...t,
              splitOrientation: t.splitOrientation === 'horizontal' ? 'vertical' : 'horizontal',
            }
          : t,
      ),
    }));
  },

  toggleSidebar: () => {
    set((state) => ({ isSidebarOpen: !state.isSidebarOpen }));
  },

  setSidebarOpen: (open) => {
    set({ isSidebarOpen: open });
  },
}));
