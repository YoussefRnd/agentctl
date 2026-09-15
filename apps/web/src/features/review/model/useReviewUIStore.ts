import { create } from 'zustand';

export type ReviewScope = 'uncommitted' | 'this_turn' | 'all_edits';

export interface ReviewTurnSelection {
  sessionId: string;
  files: string[];
}

export interface ReviewUIState {
  reviewScope: ReviewScope;
  reviewTurnSelection: ReviewTurnSelection | null;
  targetReviewFile: string | null;

  setReviewScope: (scope: ReviewScope, turnSelection?: ReviewTurnSelection) => void;
  setTargetReviewFile: (filePath: string | null) => void;
  focusReviewFile: (filePath: string, turnSelection: ReviewTurnSelection) => void;
}

export const useReviewUIStore = create<ReviewUIState>((set) => ({
  reviewScope: 'uncommitted',
  reviewTurnSelection: null,
  targetReviewFile: null,

  setReviewScope: (scope, turnSelection) =>
    set({
      reviewScope: scope,
      reviewTurnSelection: scope === 'this_turn' ? (turnSelection ?? null) : null,
    }),

  setTargetReviewFile: (filePath) => set({ targetReviewFile: filePath }),

  focusReviewFile: (filePath, turnSelection) =>
    set({
      reviewScope: 'this_turn',
      reviewTurnSelection: turnSelection,
      targetReviewFile: filePath,
    }),
}));
