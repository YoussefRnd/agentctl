import { create } from 'zustand';
import type { ContextItem } from '@agentctl/api-client';

export type WorkbenchTab = 'status' | 'changes' | 'terminal';
export type SettingsTab = 'general' | 'providers' | 'mcp';
export type ReviewScope = 'uncommitted' | 'this_turn' | 'all_edits';

export interface ReviewTurnSelection {
  sessionId: string;
  files: string[];
}

interface UIState {
  // Workbench & Layout State
  workbenchTab: WorkbenchTab | null;
  openWorkbenchTabs: WorkbenchTab[];
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

  // Composer Direct Insertion & Context Attachment
  pendingComposerInsert: string | null;
  pendingContextItem: ContextItem | null;

  // Actions
  insertIntoComposer: (text: string) => void;
  clearPendingComposerInsert: () => void;
  attachContextToComposer: (item: ContextItem) => void;
  clearPendingContextItem: () => void;
  setWorkbenchTab: (tab: WorkbenchTab) => void;
  openWorkbenchTab: (tab: WorkbenchTab) => void;
  closeWorkbenchTab: (tab: WorkbenchTab) => void;
  moveWorkbenchTab: (fromIndex: number, toIndex: number) => void;
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
  openWorkbenchTabs: ['changes', 'terminal', 'status'],
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
  pendingComposerInsert: null,
  pendingContextItem: null,

  insertIntoComposer: (text) => set({ pendingComposerInsert: text }),
  clearPendingComposerInsert: () => set({ pendingComposerInsert: null }),
  attachContextToComposer: (item) => set({ pendingContextItem: item }),
  clearPendingContextItem: () => set({ pendingContextItem: null }),

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
  setMobileSidebarOpen: (open) => set({ isMobileSidebarOpen: open }),
  setReviewScope: (scope, turnSelection) =>
    set({
      reviewScope: scope,
      reviewTurnSelection: scope === 'this_turn' ? (turnSelection ?? null) : null,
    }),
  setTargetReviewFile: (filePath) => set({ targetReviewFile: filePath }),
  focusReviewFile: (filePath, turnSelection) =>
    set((state) => ({
      openWorkbenchTabs: state.openWorkbenchTabs.includes('changes')
        ? state.openWorkbenchTabs
        : [...state.openWorkbenchTabs, 'changes'],
      workbenchTab: 'changes',
      isWorkbenchOpen: true,
      reviewScope: 'this_turn',
      reviewTurnSelection: turnSelection,
      targetReviewFile: filePath,
    })),
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
