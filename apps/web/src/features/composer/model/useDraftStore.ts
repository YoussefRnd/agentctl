import { create } from 'zustand';
import type { ContextItem } from '@agentctl/api-client';

export interface DraftState {
  sessionDrafts: Record<string, string>;
  pendingComposerInsert: string | null;
  pendingContextItem: ContextItem | null;

  setSessionDraft: (sessionId: string, draft: string) => void;
  clearSessionDraft: (sessionId: string) => void;
  insertIntoComposer: (text: string) => void;
  clearPendingComposerInsert: () => void;
  attachContextToComposer: (item: ContextItem) => void;
  clearPendingContextItem: () => void;
}

export const useDraftStore = create<DraftState>((set) => ({
  sessionDrafts: {},
  pendingComposerInsert: null,
  pendingContextItem: null,

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

  insertIntoComposer: (text) => set({ pendingComposerInsert: text }),
  clearPendingComposerInsert: () => set({ pendingComposerInsert: null }),
  attachContextToComposer: (item) => set({ pendingContextItem: item }),
  clearPendingContextItem: () => set({ pendingContextItem: null }),
}));
