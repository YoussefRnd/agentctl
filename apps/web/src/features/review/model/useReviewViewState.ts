import { useReducer, useCallback } from 'react';

export type StatusFilter = 'all' | 'modified' | 'untracked' | 'staged' | 'deleted';

export interface ReviewViewState {
  isDiscardModalOpen: boolean;
  isApplyDialogOpen: boolean;
  isPullRequestDialogOpen: boolean;
  commitMessage: string;
  isSummaryCollapsed: boolean;
  collapsedFiles: Record<string, boolean>;
  viewMode: 'inline' | 'split';
  wrapLines: boolean;
  searchQuery: string;
  statusFilter: StatusFilter;
}

export type ReviewViewAction =
  | { type: 'SET_DISCARD_MODAL_OPEN'; payload: boolean }
  | { type: 'SET_APPLY_DIALOG_OPEN'; payload: boolean }
  | { type: 'SET_PR_DIALOG_OPEN'; payload: boolean }
  | { type: 'SET_COMMIT_MESSAGE'; payload: string }
  | { type: 'TOGGLE_SUMMARY_COLLAPSE' }
  | { type: 'TOGGLE_FILE_COLLAPSE'; filePath: string }
  | { type: 'EXPAND_FILE'; filePath: string }
  | { type: 'TOGGLE_VIEW_MODE' }
  | { type: 'TOGGLE_WRAP_LINES' }
  | { type: 'SET_SEARCH_QUERY'; payload: string }
  | { type: 'SET_STATUS_FILTER'; payload: StatusFilter }
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
    case 'TOGGLE_WRAP_LINES':
      return { ...state, wrapLines: !state.wrapLines };
    case 'SET_SEARCH_QUERY':
      return {
        ...state,
        searchQuery: action.payload,
      };
    case 'SET_STATUS_FILTER':
      return {
        ...state,
        statusFilter: action.payload,
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
    viewMode: 'inline',
    wrapLines: false,
    searchQuery: '',
    statusFilter: 'all',
  });

  const toggleFileCollapse = useCallback((filePath: string) => {
    dispatch({ type: 'TOGGLE_FILE_COLLAPSE', filePath });
  }, []);

  const expandAll = useCallback((paths: string[]) => {
    dispatch({ type: 'EXPAND_ALL', payload: paths });
  }, []);

  const collapseAll = useCallback(() => {
    dispatch({ type: 'COLLAPSE_ALL' });
  }, []);

  return { state, dispatch, toggleFileCollapse, expandAll, collapseAll };
}
