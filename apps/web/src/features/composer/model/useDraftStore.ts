import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { persistentStorage } from '@/shared/lib/persistentStorage';
import type { InitialSessionSettings } from '@agentctl/api-client';
import { sessionRowSchema, type SessionMode, type SessionRow } from '@agentctl/shared';
import type { ContextItem } from '@agentctl/api-client';

export interface HomeDraft extends InitialSessionSettings {
  providerId?: string;
  thinkingConfig?: { id: string; value: string };
  mode?: SessionMode;
  files: File[];
  contexts: ContextItem[];
  session?: SessionRow;
  uploadedFiles?: Array<{ file: File; attachmentId: string }>;
}

export const EMPTY_HOME_DRAFT: HomeDraft = { files: [], contexts: [] };

export interface DraftState {
  homeDrafts: Record<string, HomeDraft>;
  updateHomeDraft: (projectId: string, patch: Partial<HomeDraft>) => void;
  clearHomeDraft: (projectId: string) => void;
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

export const useDraftStore = create<DraftState>()(
  persist(
    (set) => ({
      homeDrafts: {},
      updateHomeDraft: (projectId, patch) =>
        set((state) => ({
          homeDrafts: {
            ...state.homeDrafts,
            [projectId]: { ...(state.homeDrafts[projectId] ?? EMPTY_HOME_DRAFT), ...patch },
          },
        })),
      clearHomeDraft: (projectId) =>
        set((state) => {
          const homeDrafts = { ...state.homeDrafts };
          const sessionDrafts = { ...state.sessionDrafts };
          delete homeDrafts[projectId];
          delete sessionDrafts[`home:${projectId}`];
          return { homeDrafts, sessionDrafts };
        }),
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
    }),
    {
      name: 'agentctl-composer-drafts',
      version: 1,
      storage: persistentStorage,
      partialize: (state) => ({
        sessionDrafts: state.sessionDrafts,
        homeDrafts: Object.fromEntries(
          Object.entries(state.homeDrafts).map(([id, draft]) => {
            // Browser File objects and upload handles cannot survive a restart.
            const { files: _files, uploadedFiles: _uploads, ...settings } = draft;
            return [id, { ...settings, files: [] }];
          }),
        ),
      }),
      merge: (saved, current) => {
        const drafts = saved as Partial<DraftState> | undefined;
        return {
          ...current,
          sessionDrafts: Object.fromEntries(
            Object.entries(drafts?.sessionDrafts ?? {}).filter(
              ([, value]) => typeof value === 'string',
            ),
          ),
          homeDrafts: Object.fromEntries(
            Object.entries(drafts?.homeDrafts ?? {})
              .filter(([, value]) => value && typeof value === 'object')
              .map(([id, draft]) => [
                id,
                {
                  ...draft,
                  session: sessionRowSchema.safeParse(draft.session).data,
                  files: [],
                  contexts: Array.isArray(draft.contexts) ? draft.contexts : [],
                },
              ]),
          ),
        };
      },
    },
  ),
);
