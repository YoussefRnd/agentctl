import { create } from 'zustand';

export interface ShellState {
  isMobileSidebarOpen: boolean;
  isShortcutsOpen: boolean;

  setMobileSidebarOpen: (open: boolean) => void;
  openShortcuts: () => void;
  closeShortcuts: () => void;
  toggleShortcuts: () => void;
}

export const useShellStore = create<ShellState>((set) => ({
  isMobileSidebarOpen: false,
  isShortcutsOpen: false,

  setMobileSidebarOpen: (open) => set({ isMobileSidebarOpen: open }),
  openShortcuts: () => set({ isShortcutsOpen: true }),
  closeShortcuts: () => set({ isShortcutsOpen: false }),
  toggleShortcuts: () => set((state) => ({ isShortcutsOpen: !state.isShortcutsOpen })),
}));
