import { useMemo, useCallback } from 'react';
import { parseDiff } from '../../../utils/diff-parser';
import { matchSorter } from 'match-sorter';
import { ConfirmationModal } from '@agentctl/ui';
import { ReviewHeader, type ReviewFile, type FileState } from './ReviewHeader';
import { ReviewMergeDialog } from './ReviewMergeDialog';
import { useReviewViewState } from '../hooks/useReviewViewState';
import { ReviewClosedState, ReviewLoadingState, ReviewEmptyState } from './ReviewStates';
import { ReviewFileList } from './ReviewFileList';
import { ReviewCommitInput } from './ReviewCommitInput';
import { useSession } from '../../../contexts/SessionContext';

export function ReviewView() {
  const {
    reviewData,
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

  const files = reviewData.files;
  const sessionStatus = sessionData?.session.status;
  const sessionMode = sessionData?.session.mode;

  const onStage = stageFile;
  const onUnstage = unstageFile;
  const onRevert = revertFile;
  const onStageAll = stageAll;
  const onUnstageAll = unstageAll;

  const { state, dispatch, toggleFileCollapse, toggleSection, expandAll, collapseAll } =
    useReviewViewState();

  const scrollToDiff = useCallback((direction: 'next' | 'prev') => {
    const container = document.querySelector('.custom-scrollbar');
    if (!container) return;

    const diffBlocks = Array.from(document.querySelectorAll('[id^="diff-block-"]'));
    if (diffBlocks.length === 0) return;

    const containerRect = container.getBoundingClientRect();
    let targetBlock: Element | undefined;

    if (direction === 'next') {
      targetBlock =
        diffBlocks.find((block) => {
          const rect = block.getBoundingClientRect();
          return rect.top - containerRect.top > 10;
        }) ?? diffBlocks[0];
    } else {
      targetBlock =
        [...diffBlocks].reverse().find((block) => {
          const rect = block.getBoundingClientRect();
          return rect.top - containerRect.top < -10;
        }) ?? diffBlocks[diffBlocks.length - 1];
    }

    targetBlock.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const isClosed = sessionStatus === 'merged' || sessionStatus === 'discarded';

  const activeFiles = useMemo(() => files.filter((f) => f.state !== 'committed'), [files]);

  const filteredFiles = useMemo(() => {
    if (!state.searchQuery) return activeFiles;
    return matchSorter(activeFiles, state.searchQuery, {
      keys: ['path', 'diff'],
      threshold: matchSorter.rankings.CONTAINS,
    });
  }, [activeFiles, state.searchQuery]);

  const parsedFiles = useMemo(() => {
    return filteredFiles.map((file) => ({
      ...file,
      hunks: parseDiff(file.diff),
    }));
  }, [filteredFiles]);

  const grouped = useMemo(() => {
    const initial: Record<FileState, (ReviewFile & { hunks: ReturnType<typeof parseDiff> })[]> = {
      conflicted: [],
      untracked: [],
      staged: [],
      modified: [],
      deleted: [],
      committed: [],
    };
    return parsedFiles.reduce((acc, file) => {
      acc[file.state].push(file);
      return acc;
    }, initial);
  }, [parsedFiles]);

  const handleSelectFile = useCallback(
    (path: string) => {
      const file = parsedFiles.find((f) => f.path === path);
      if (file && state.collapsedSections[file.state]) {
        toggleSection(file.state);
      }
      if (state.collapsedFiles[path]) {
        toggleFileCollapse(path);
      }
      setTimeout(() => {
        const el = document.getElementById(`diff-block-${path}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 50);
    },
    [parsedFiles, state.collapsedSections, state.collapsedFiles, toggleSection, toggleFileCollapse],
  );

  const handleMergeSubmit = () => {
    void onMerge(state.commitMessage);
    dispatch({ type: 'SET_MERGE_DIALOG_OPEN', payload: false });
  };

  const fileStats = useMemo(() => {
    const map = new Map<string, { additions: number; deletions: number }>();
    parsedFiles.forEach((file) => {
      let additions = 0;
      let deletions = 0;
      file.hunks.forEach((hunk) => {
        hunk.lines.forEach((line) => {
          if (line.type === 'added') additions++;
          else if (line.type === 'removed') deletions++;
        });
      });
      map.set(file.path, { additions, deletions });
    });
    return map;
  }, [parsedFiles]);

  const allCollapsed = useMemo(() => {
    return parsedFiles.every((file) => state.collapsedFiles[file.path]);
  }, [parsedFiles, state.collapsedFiles]);

  const onToggleAll = useCallback(() => {
    if (allCollapsed) {
      expandAll(parsedFiles.map((f) => f.path));
    } else {
      collapseAll();
    }
  }, [allCollapsed, expandAll, collapseAll, parsedFiles]);

  if (isClosed) return <ReviewClosedState sessionStatus={sessionStatus} />;
  if (isLoading) return <ReviewLoadingState />;

  const stageFiles = grouped.staged;
  const stagedCount = stageFiles.length;

  return (
    <div className="bg-surface-secondary/5 flex h-full min-h-0 flex-col">
      <ReviewHeader
        files={activeFiles}
        isMerging={isMerging}
        isDiscarding={isDiscarding}
        onOpenMergeDialog={() => {
          dispatch({ type: 'SET_MERGE_DIALOG_OPEN', payload: true });
        }}
        onOpenDiscardModal={() => {
          dispatch({ type: 'SET_DISCARD_MODAL_OPEN', payload: true });
        }}
        viewMode={state.viewMode}
        onToggleViewMode={() => {
          dispatch({ type: 'TOGGLE_VIEW_MODE' });
        }}
        searchQuery={state.searchQuery}
        onSearchChange={(q) => {
          dispatch({ type: 'SET_SEARCH_QUERY', payload: q });
        }}
        onNextDiff={() => {
          scrollToDiff('next');
        }}
        onPrevDiff={() => {
          scrollToDiff('prev');
        }}
        allCollapsed={allCollapsed}
        onToggleAll={onToggleAll}
        onSelectFile={handleSelectFile}
      />

      {sessionMode === 'local' && (
        <div className="border-accent/15 bg-accent/5 text-text-main/80 mx-4 mt-3 flex flex-col gap-1.5 rounded border px-3 py-2.5 text-xs transition-all select-none">
          <div className="text-accent flex items-center gap-2 font-semibold">
            <span className="bg-accent inline-block h-1.5 w-1.5 rounded-full shadow-[0_0_8px_currentColor]" />
            Local session scope (Snapshot)
          </div>
          <div className="text-[11px] leading-relaxed opacity-90">
            Only changes made since this local session was initialized are shown and committed.
            Pre-existing untracked or modified changes in your repository are protected and
            preserved.
          </div>
        </div>
      )}

      {filteredFiles.length === 0 ? (
        <ReviewEmptyState searchQuery={state.searchQuery} />
      ) : (
        <ReviewFileList
          groupedFiles={grouped}
          collapsedSections={state.collapsedSections}
          collapsedFiles={state.collapsedFiles}
          fileStats={fileStats}
          viewMode={state.viewMode}
          onToggleSection={toggleSection}
          onToggleFile={toggleFileCollapse}
          onStage={(p) => {
            void onStage(p);
          }}
          onUnstage={(p) => {
            void onUnstage(p);
          }}
          onRevert={(p) => {
            void onRevert(p);
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
          isCommitting={isCommitting}
          onStageAll={() => {
            void onStageAll();
          }}
          onUnstageAll={() => {
            void onUnstageAll();
          }}
          onMergeSession={() => {
            dispatch({ type: 'SET_MERGE_DIALOG_OPEN', payload: true });
          }}
          onDiscardChanges={() => {
            dispatch({ type: 'SET_DISCARD_MODAL_OPEN', payload: true });
          }}
          isStagingAll={isStagingAll}
          isUnstagingAll={isUnstagingAll}
          isMerging={isMerging}
          isDiscarding={isDiscarding}
          hasUnstaged={grouped.modified.length > 0 || grouped.untracked.length > 0}
          hasChanges={activeFiles.length > 0}
        />
      )}

      <ConfirmationModal
        isOpen={state.isDiscardModalOpen}
        title="Discard all changes?"
        message="This will permanently revert all modifications in this workspace. This action cannot be undone."
        confirmText="Discard Changes"
        cancelText="Cancel"
        type="brand-red"
        onConfirm={() => {
          void onDiscard();
          dispatch({ type: 'SET_DISCARD_MODAL_OPEN', payload: false });
        }}
        onCancel={() => {
          dispatch({ type: 'SET_DISCARD_MODAL_OPEN', payload: false });
        }}
      />

      <ReviewMergeDialog
        open={state.isMergeDialogOpen}
        onOpenChange={(open) => {
          dispatch({ type: 'SET_MERGE_DIALOG_OPEN', payload: open });
        }}
        commitMessage={state.commitMessage}
        onCommitMessageChange={(val) => {
          dispatch({ type: 'SET_COMMIT_MESSAGE', payload: val });
        }}
        onCancel={() => {
          dispatch({ type: 'SET_MERGE_DIALOG_OPEN', payload: false });
        }}
        onConfirm={handleMergeSubmit}
      />
    </div>
  );
}
