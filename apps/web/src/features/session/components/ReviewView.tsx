import { useMemo, useCallback, useEffect } from 'react';
import { ReviewHeader } from './ReviewHeader';
import { ReviewDialogs } from './ReviewDialogs';
import { useReviewViewState } from '../hooks/useReviewViewState';
import { useReviewDiffs } from '../hooks/useReviewDiffs';
import { ReviewClosedState, ReviewLoadingState, ReviewEmptyState } from './ReviewStates';
import { ReviewFileList } from './ReviewFileList';
import { ReviewCommitInput } from './ReviewCommitInput';
import { useSession } from '../../../contexts/SessionContext';
import { openInEditor } from '@agentctl/api-client';
import { toast } from 'sonner';

export function ReviewView() {
  const {
    reviewData,
    refetchReview,
    isLoadingReview: isLoading,
    stageFile,
    unstageFile,
    revertFile,
    stageAll,
    unstageAll,
    commitChanges: onCommitChanges,
    isCommitting,
    isStagingAll,
    isUnstagingAll,

    sessionData,
    mergeSession: onMerge,
    discardSession: onDiscard,
    isMergingSession: isMerging,
    isDiscardingSession: isDiscarding,
  } = useSession();

  useEffect(() => {
    refetchReview();
  }, [refetchReview]);

  const files = reviewData.files;
  const sessionStatus = sessionData?.session.status;

  const onStage = stageFile;
  const onUnstage = unstageFile;
  const onRevert = revertFile;
  const onStageAll = stageAll;
  const onUnstageAll = unstageAll;

  const { state, dispatch, toggleFileCollapse, toggleSection, expandAll, collapseAll } =
    useReviewViewState();

  const { activeFiles, parsedFiles, grouped, fileStats } = useReviewDiffs(files, state.searchQuery);

  const isClosed = sessionStatus === 'merged' || sessionStatus === 'discarded';

  const handleMergeSubmit = () => {
    void onMerge(state.commitMessage);
    dispatch({ type: 'SET_MERGE_DIALOG_OPEN', payload: false });
  };

  const allCollapsed = useMemo(() => {
    if (parsedFiles.length === 0) return true;
    return parsedFiles.every((file) => (state.collapsedFiles[file.path] ?? true) === true);
  }, [parsedFiles, state.collapsedFiles]);

  const onToggleAll = useCallback(() => {
    if (allCollapsed) {
      expandAll(parsedFiles.map((f) => f.path));
    } else {
      collapseAll();
    }
  }, [allCollapsed, expandAll, collapseAll, parsedFiles]);

  const worktreePath = sessionData?.session.worktreePath || '';

  const handleOpenFile = useCallback(
    async (filePath: string) => {
      if (!worktreePath) return;
      const preferredEditor =
        (typeof window !== 'undefined'
          ? localStorage.getItem('agentctl:preferred-editor')
          : null) ?? 'cursor';
      const fullPath = worktreePath.endsWith('/')
        ? `${worktreePath}${filePath}`
        : `${worktreePath}/${filePath}`;

      try {
        await openInEditor(preferredEditor, fullPath);
        const fileName = filePath.split('/').pop() ?? filePath;
        toast.success(`Opened ${fileName}`);
      } catch {
        toast.error(`Could not open file in editor`);
      }
    },
    [worktreePath],
  );

  if (isClosed) return <ReviewClosedState sessionStatus={sessionStatus} />;
  if (isLoading) return <ReviewLoadingState />;

  const stageFiles = grouped.staged;
  const stagedCount = stageFiles.length;

  return (
    <div className="bg-surface-secondary/5 flex h-full min-h-0 flex-col">
      <ReviewHeader
        files={activeFiles}
        viewMode={state.viewMode}
        onToggleViewMode={() => {
          dispatch({ type: 'TOGGLE_VIEW_MODE' });
        }}
        searchQuery={state.searchQuery}
        onSearchChange={(q) => {
          dispatch({ type: 'SET_SEARCH_QUERY', payload: q });
        }}
        allCollapsed={allCollapsed}
        onToggleAll={onToggleAll}
      />

      {activeFiles.length === 0 ? (
        <ReviewEmptyState searchQuery={state.searchQuery} />
      ) : (
        <ReviewFileList
          groupedFiles={grouped}
          collapsedSections={state.collapsedSections}
          collapsedFiles={state.collapsedFiles}
          viewMode={state.viewMode}
          fileStats={fileStats}
          onToggleSection={(s) => {
            toggleSection(s);
          }}
          onToggleFile={(p) => {
            toggleFileCollapse(p);
          }}
          onStage={(p) => {
            void onStage(p);
          }}
          onUnstage={(p) => {
            void onUnstage(p);
          }}
          onRevert={(p) => {
            void onRevert(p);
          }}
          onOpenFile={(p) => {
            void handleOpenFile(p);
          }}
          onStageAll={() => {
            void onStageAll();
          }}
          onUnstageAll={() => {
            void onUnstageAll();
          }}
          isStagingAll={isStagingAll}
          isUnstagingAll={isUnstagingAll}
        />
      )}

      {activeFiles.length > 0 && (
        <ReviewCommitInput
          stagedCount={stagedCount}
          onCommit={(msg) => {
            void onCommitChanges(msg);
          }}
          onMergeSession={() => {
            dispatch({ type: 'SET_MERGE_DIALOG_OPEN', payload: true });
          }}
          onDiscardChanges={() => {
            dispatch({ type: 'SET_DISCARD_MODAL_OPEN', payload: true });
          }}
          status={{
            isCommitting,
            isMerging,
            isDiscarding,
            hasChanges: activeFiles.length > 0,
          }}
        />
      )}

      <ReviewDialogs
        isDiscardModalOpen={state.isDiscardModalOpen}
        isMergeDialogOpen={state.isMergeDialogOpen}
        commitMessage={state.commitMessage}
        onCloseDiscardModal={() => {
          dispatch({ type: 'SET_DISCARD_MODAL_OPEN', payload: false });
        }}
        onConfirmDiscard={() => {
          void onDiscard();
          dispatch({ type: 'SET_DISCARD_MODAL_OPEN', payload: false });
        }}
        onSetMergeDialogOpen={(open) => {
          dispatch({ type: 'SET_MERGE_DIALOG_OPEN', payload: open });
        }}
        onCommitMessageChange={(val) => {
          dispatch({ type: 'SET_COMMIT_MESSAGE', payload: val });
        }}
        onConfirmMerge={handleMergeSubmit}
      />
    </div>
  );
}
