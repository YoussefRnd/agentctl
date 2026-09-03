import { create } from 'zustand';

export type WorkbenchTab = 'status' | 'changes' | 'terminal';
export type SettingsTab = 'general' | 'providers' | 'mcp';
export type ReviewScope = 'uncommitted' | 'this_turn' | 'all_edits';

export interface ReviewTurnSelection {
  sessionId: string;
  files: string[];
}

interface UIState {
  // Workbench & Layout State
  workbenchTab: WorkbenchTab;
  isWorkbenchOpen: boolean;
  isMaximized: boolean;
  isMobileSidebarOpen: boolean;
  reviewScope: ReviewScope;
  reviewTurnSelection: ReviewTurnSelection | null;

  // Global Modals State
  isCommandPaletteOpen: boolean;
  isMcpSettingsOpen: boolean;
  isSettingsOpen: boolean;
  settingsTab: SettingsTab;
  isShortcutsOpen: boolean;

  // Session Drafts State
  sessionDrafts: Record<string, string>;

  // Active Subagent View (Replaces Main Chat Feed)
  activeSubagentId: string | null;
  activeSubagent:
    import('../../features/session/components/cards/subagentBlockUtils').SubagentGroup | null;

  // Review View Focus
  targetReviewFile: string | null;

  // Actions
  setWorkbenchTab: (tab: WorkbenchTab) => void;
  setWorkbenchOpen: (open: boolean) => void;
  toggleWorkbench: () => void;
  setMaximized: (maximized: boolean) => void;
  toggleMaximized: () => void;
  setMobileSidebarOpen: (open: boolean) => void;
  setReviewScope: (scope: ReviewScope, turnSelection?: ReviewTurnSelection) => void;
  setTargetReviewFile: (filePath: string | null) => void;
  focusReviewFile: (filePath: string, turnSelection: ReviewTurnSelection) => void;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  toggleCommandPalette: () => void;
  openMcpSettings: () => void;
  closeMcpSettings: () => void;
  toggleMcpSettings: () => void;
  setSettingsTab: (tab: SettingsTab) => void;
  openSettings: (tab?: SettingsTab) => void;
  closeSettings: () => void;
  toggleSettings: (tab?: SettingsTab) => void;
  openShortcuts: () => void;
  closeShortcuts: () => void;
  toggleShortcuts: () => void;
  setSessionDraft: (sessionId: string, draft: string) => void;
  clearSessionDraft: (sessionId: string) => void;
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
  reviewScope: 'uncommitted',
  reviewTurnSelection: null,
  isCommandPaletteOpen: false,
  isMcpSettingsOpen: false,
  isSettingsOpen: false,
  settingsTab: 'general',
  isShortcutsOpen: false,
  sessionDrafts: {},
  activeSubagentId: null,
  activeSubagent: null,
  targetReviewFile: null,

  setWorkbenchTab: (tab) => set({ workbenchTab: tab, isWorkbenchOpen: true }),
  setWorkbenchOpen: (open) => set({ isWorkbenchOpen: open }),
  toggleWorkbench: () => set((state) => ({ isWorkbenchOpen: !state.isWorkbenchOpen })),
  setMaximized: (maximized) => set({ isMaximized: maximized }),
  toggleMaximized: () => set((state) => ({ isMaximized: !state.isMaximized })),
  setMobileSidebarOpen: (open) => set({ isMobileSidebarOpen: open }),
  setReviewScope: (scope, turnSelection) =>
    set({
      reviewScope: scope,
      reviewTurnSelection: scope === 'this_turn' ? (turnSelection ?? null) : null,
    }),
  setTargetReviewFile: (filePath) => set({ targetReviewFile: filePath }),
  focusReviewFile: (filePath, turnSelection) =>
    set({
      workbenchTab: 'changes',
      isWorkbenchOpen: true,
      reviewScope: 'this_turn',
      reviewTurnSelection: turnSelection,
      targetReviewFile: filePath,
    }),
  openCommandPalette: () => set({ isCommandPaletteOpen: true }),
  closeCommandPalette: () => set({ isCommandPaletteOpen: false }),
  toggleCommandPalette: () =>
    set((state) => ({ isCommandPaletteOpen: !state.isCommandPaletteOpen })),
  openMcpSettings: () => set({ isMcpSettingsOpen: true }),
  closeMcpSettings: () => set({ isMcpSettingsOpen: false }),
  toggleMcpSettings: () => set((state) => ({ isMcpSettingsOpen: !state.isMcpSettingsOpen })),
  setSettingsTab: (tab) => set({ settingsTab: tab }),
  openSettings: (tab) =>
    set((state) => ({ isSettingsOpen: true, settingsTab: tab ?? state.settingsTab })),
  closeSettings: () => set({ isSettingsOpen: false }),
  toggleSettings: (tab) =>
    set((state) => ({
      isSettingsOpen: !state.isSettingsOpen,
      settingsTab: tab ?? state.settingsTab,
    })),
  openShortcuts: () => set({ isShortcutsOpen: true }),
  closeShortcuts: () => set({ isShortcutsOpen: false }),
  toggleShortcuts: () => set((state) => ({ isShortcutsOpen: !state.isShortcutsOpen })),
  setSessionDraft: (sessionId, draft) =>
    set((state) => ({
      sessionDrafts: {
        ...state.sessionDrafts,
        [sessionId]: draft,
      },
    })),
  clearSessionDraft: (sessionId) =>
    set((state) => {
      const next = { ...state.sessionDrafts };
      delete next[sessionId];
      return { sessionDrafts: next };
    }),
  setActiveSubagentId: (id) => set({ activeSubagentId: id }),
  setActiveSubagent: (group) =>
    set({
      activeSubagent: group,
      activeSubagentId: group
        ? ((group.subagentEvent.data as { subagentId?: string })?.subagentId ?? null)
        : null,
    }),
}));
