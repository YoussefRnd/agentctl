import { create } from 'zustand';

export type SettingsTab = 'general' | 'providers' | 'mcp';

export interface SettingsOverlayState {
  isSettingsOpen: boolean;
  settingsTab: SettingsTab;
  isMcpSettingsOpen: boolean;

  setSettingsTab: (tab: SettingsTab) => void;
  openSettings: (tab?: SettingsTab) => void;
  closeSettings: () => void;
  toggleSettings: (tab?: SettingsTab) => void;
  openMcpSettings: () => void;
  closeMcpSettings: () => void;
  toggleMcpSettings: () => void;
}

export const useSettingsOverlayStore = create<SettingsOverlayState>((set) => ({
  isSettingsOpen: false,
  settingsTab: 'general',
  isMcpSettingsOpen: false,

  setSettingsTab: (tab) => set({ settingsTab: tab }),

  openSettings: (tab) =>
    set((state) => ({
      isSettingsOpen: true,
      settingsTab: tab ?? state.settingsTab,
    })),

  closeSettings: () => set({ isSettingsOpen: false }),

  toggleSettings: (tab) =>
    set((state) => ({
      isSettingsOpen: !state.isSettingsOpen,
      settingsTab: tab ?? state.settingsTab,
    })),

  openMcpSettings: () => set({ isMcpSettingsOpen: true, isSettingsOpen: true, settingsTab: 'mcp' }),
  closeMcpSettings: () => set({ isMcpSettingsOpen: false }),
  toggleMcpSettings: () => set((state) => ({ isMcpSettingsOpen: !state.isMcpSettingsOpen })),
}));
