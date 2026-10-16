import { create } from 'zustand';

export type WorkbenchTab = 'status' | 'changes' | 'terminal';

export function isTerminalTab(tab: string | null | undefined): boolean {
  return tab === 'terminal';
}

export function getTerminalTabId(_tab: string | null | undefined): string {
  return '1';
}

export interface WorkbenchState {
  workbenchTab: WorkbenchTab | null;
  openWorkbenchTabs: WorkbenchTab[];
  isWorkbenchOpen: boolean;
  isMaximized: boolean;

  setWorkbenchTab: (tab: WorkbenchTab) => void;
  openWorkbenchTab: (tab: WorkbenchTab) => void;
  closeWorkbenchTab: (tab: WorkbenchTab) => void;
  moveWorkbenchTab: (fromIndex: number, toIndex: number) => void;
  setWorkbenchOpen: (open: boolean) => void;
  toggleWorkbench: () => void;
  setMaximized: (maximized: boolean) => void;
  toggleMaximized: () => void;
}

export const useWorkbenchStore = create<WorkbenchState>((set) => ({
  workbenchTab: 'status',
  openWorkbenchTabs: ['changes', 'terminal', 'status'],
  isWorkbenchOpen: true,
  isMaximized: false,

  setWorkbenchTab: (tab) =>
    set((state) => ({
      openWorkbenchTabs: state.openWorkbenchTabs.includes(tab)
        ? state.openWorkbenchTabs
        : [...state.openWorkbenchTabs, tab],
      workbenchTab: tab,
      isWorkbenchOpen: true,
    })),

  openWorkbenchTab: (tab) =>
    set((state) => ({
      openWorkbenchTabs: state.openWorkbenchTabs.includes(tab)
        ? state.openWorkbenchTabs
        : [...state.openWorkbenchTabs, tab],
      workbenchTab: tab,
      isWorkbenchOpen: true,
    })),

  closeWorkbenchTab: (tab) =>
    set((state) => {
      const nextTabs = state.openWorkbenchTabs.filter((t) => t !== tab);
      let nextActive = state.workbenchTab;
      if (state.workbenchTab === tab) {
        const closedIndex = state.openWorkbenchTabs.indexOf(tab);
        nextActive = nextTabs[closedIndex] ?? nextTabs[closedIndex - 1] ?? null;
      }
      return {
        openWorkbenchTabs: nextTabs,
        workbenchTab: nextActive,
      };
    }),

  moveWorkbenchTab: (fromIndex, toIndex) =>
    set((state) => {
      if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return state;
      const nextTabs = [...state.openWorkbenchTabs];
      const [moved] = nextTabs.splice(fromIndex, 1);
      if (!moved) return state;
      nextTabs.splice(toIndex, 0, moved);
      return { openWorkbenchTabs: nextTabs };
    }),

  setWorkbenchOpen: (open) => set({ isWorkbenchOpen: open }),
  toggleWorkbench: () => set((state) => ({ isWorkbenchOpen: !state.isWorkbenchOpen })),
  setMaximized: (maximized) => set({ isMaximized: maximized }),
  toggleMaximized: () => set((state) => ({ isMaximized: !state.isMaximized })),
}));
