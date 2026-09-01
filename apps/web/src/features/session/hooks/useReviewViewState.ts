import { useReducer, useCallback } from 'react';
import type { FileState } from '../components/ReviewHeader';

export interface ReviewViewState {
  isDiscardModalOpen: boolean;
  isApplyDialogOpen: boolean;
  isPullRequestDialogOpen: boolean;
  commitMessage: string;
  isSummaryCollapsed: boolean;
  collapsedFiles: Record<string, boolean>;
  collapsedSections: Record<FileState, boolean>;
  viewMode: 'inline' | 'split';
  searchQuery: string;
}

export type ReviewViewAction =
  | { type: 'SET_DISCARD_MODAL_OPEN'; payload: boolean }
  | { type: 'SET_APPLY_DIALOG_OPEN'; payload: boolean }
  | { type: 'SET_PR_DIALOG_OPEN'; payload: boolean }
  | { type: 'SET_COMMIT_MESSAGE'; payload: string }
  | { type: 'TOGGLE_SUMMARY_COLLAPSE' }
  | { type: 'TOGGLE_FILE_COLLAPSE'; filePath: string }
  | { type: 'TOGGLE_SECTION'; section: FileState }
  | { type: 'EXPAND_FILE'; filePath: string }
  | { type: 'TOGGLE_VIEW_MODE' }
  | { type: 'SET_SEARCH_QUERY'; payload: string }
  | { type: 'COLLAPSE_ALL' }
  | { type: 'EXPAND_ALL'; payload: string[] };

function reviewViewReducer(state: ReviewViewState, action: ReviewViewAction): ReviewViewState {
  switch (action.type) {
    case 'SET_DISCARD_MODAL_OPEN':
      return { ...state, isDiscardModalOpen: action.payload };
    case 'SET_APPLY_DIALOG_OPEN':
      return { ...state, isApplyDialogOpen: action.payload };
    case 'SET_PR_DIALOG_OPEN':
      return { ...state, isPullRequestDialogOpen: action.payload };
    case 'SET_COMMIT_MESSAGE':
      return { ...state, commitMessage: action.payload };
    case 'TOGGLE_SUMMARY_COLLAPSE':
      return { ...state, isSummaryCollapsed: !state.isSummaryCollapsed };
    case 'TOGGLE_FILE_COLLAPSE': {
      const isCurrentlyCollapsed = state.collapsedFiles[action.filePath] ?? true;
      return {
        ...state,
        collapsedFiles: {
          ...state.collapsedFiles,
          [action.filePath]: !isCurrentlyCollapsed,
        },
      };
    }
    case 'TOGGLE_SECTION': {
      const section = action.section;
      return {
        ...state,
        collapsedSections: {
          ...state.collapsedSections,
          [section]: !state.collapsedSections[section],
        },
      };
    }
    case 'EXPAND_FILE':
      return {
        ...state,
        collapsedFiles: {
          ...state.collapsedFiles,
          [action.filePath]: false,
        },
      };
    case 'TOGGLE_VIEW_MODE':
      return {
        ...state,
        viewMode: state.viewMode === 'inline' ? 'split' : 'inline',
      };
    case 'SET_SEARCH_QUERY':
      return {
        ...state,
        searchQuery: action.payload,
      };
    case 'COLLAPSE_ALL':
      return { ...state, collapsedFiles: {} };
    case 'EXPAND_ALL': {
      const expanded: Record<string, boolean> = {};
      for (const path of action.payload) {
        expanded[path] = false;
      }
      return { ...state, collapsedFiles: expanded };
    }
    default:
      return state;
  }
}

export function useReviewViewState() {
  const [state, dispatch] = useReducer(reviewViewReducer, {
    isDiscardModalOpen: false,
    isApplyDialogOpen: false,
    isPullRequestDialogOpen: false,
    commitMessage: '',
    isSummaryCollapsed: false,
    collapsedFiles: {},
    collapsedSections: {
      conflicted: false,
      untracked: false,
      staged: false,
      modified: false,
      deleted: false,
      committed: false,
    },
    viewMode: 'inline',
    searchQuery: '',
  });

  const toggleFileCollapse = useCallback((filePath: string) => {
    dispatch({ type: 'TOGGLE_FILE_COLLAPSE', filePath });
  }, []);

  const toggleSection = useCallback((section: FileState) => {
    dispatch({ type: 'TOGGLE_SECTION', section });
  }, []);

  const expandAll = useCallback((paths: string[]) => {
    dispatch({ type: 'EXPAND_ALL', payload: paths });
  }, []);

  const collapseAll = useCallback(() => {
    dispatch({ type: 'COLLAPSE_ALL' });
  }, []);

  return { state, dispatch, toggleFileCollapse, toggleSection, expandAll, collapseAll };
}
