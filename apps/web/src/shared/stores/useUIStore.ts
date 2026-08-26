import { create } from 'zustand';

export type WorkbenchTab = 'status' | 'changes' | 'terminal';

interface UIState {
  // Workbench & Layout State
  workbenchTab: WorkbenchTab;
  isWorkbenchOpen: boolean;
  isMaximized: boolean;
  isMobileSidebarOpen: boolean;

  // Global Modals State
  isMcpSettingsOpen: boolean;
  isSettingsOpen: boolean;

  // Active Subagent View (Replaces Main Chat Feed)
  activeSubagentId: string | null;
  activeSubagent:
    import('../../features/session/components/cards/subagentBlockUtils').SubagentGroup | null;

  // Actions
  setWorkbenchTab: (tab: WorkbenchTab) => void;
  setWorkbenchOpen: (open: boolean) => void;
  toggleWorkbench: () => void;
  setMaximized: (maximized: boolean) => void;
  toggleMaximized: () => void;
  setMobileSidebarOpen: (open: boolean) => void;
  openMcpSettings: () => void;
  closeMcpSettings: () => void;
  toggleMcpSettings: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  toggleSettings: () => void;
  setActiveSubagentId: (id: string | null) => void;
  setActiveSubagent: (
    group:
      import('../../features/session/components/cards/subagentBlockUtils').SubagentGroup | null,
  ) => void;
}

export const useUIStore = create<UIState>((set) => ({
  workbenchTab: 'status',
  isWorkbenchOpen: true,
  isMaximized: false,
  isMobileSidebarOpen: false,
  isMcpSettingsOpen: false,
  isSettingsOpen: false,
  activeSubagentId: null,
  activeSubagent: null,

  setWorkbenchTab: (tab) => set({ workbenchTab: tab, isWorkbenchOpen: true }),
  setWorkbenchOpen: (open) => set({ isWorkbenchOpen: open }),
  toggleWorkbench: () => set((state) => ({ isWorkbenchOpen: !state.isWorkbenchOpen })),
  setMaximized: (maximized) => set({ isMaximized: maximized }),
  toggleMaximized: () => set((state) => ({ isMaximized: !state.isMaximized })),
  setMobileSidebarOpen: (open) => set({ isMobileSidebarOpen: open }),
  openMcpSettings: () => set({ isMcpSettingsOpen: true }),
  closeMcpSettings: () => set({ isMcpSettingsOpen: false }),
  toggleMcpSettings: () => set((state) => ({ isMcpSettingsOpen: !state.isMcpSettingsOpen })),
  openSettings: () => set({ isSettingsOpen: true }),
  closeSettings: () => set({ isSettingsOpen: false }),
  toggleSettings: () => set((state) => ({ isSettingsOpen: !state.isSettingsOpen })),
  setActiveSubagentId: (id) => set({ activeSubagentId: id }),
  setActiveSubagent: (group) =>
    set({
      activeSubagent: group,
      activeSubagentId: group
        ? ((group.subagentEvent.data as { subagentId?: string })?.subagentId ?? null)
        : null,
    }),
}));
