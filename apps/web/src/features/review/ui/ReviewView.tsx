import { canMutateWorkspace } from '@agentctl/shared';
import { useMemo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ReviewHeader } from './ReviewHeader';
import { ReviewDialogs } from './ReviewDialogs';
import { useReviewViewState } from '../model/useReviewViewState';
import { useReviewDiffs } from '../model/useReviewDiffs';
import { ReviewClosedState, ReviewLoadingState, ReviewEmptyState } from './ReviewStates';
import { ReviewFileList } from './ReviewFileList';
import { ReviewGitActions } from './ReviewGitActions';
import { useOpenWorkspaceFile, useSession, useSessionStream } from '@/features/sessions';
import { extractLatestTurnTouchedFiles, resolveTurnReviewFiles } from '../lib/turnChanges';
import { useReviewUIStore, type ReviewScope } from '../model/useReviewUIStore';
import { useGitStatus } from '../model/useGitStatus';
import {
  useMutation,
  useQueries,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import type { ReviewFileItem } from '@agentctl/shared';
import {
  api,
  assertApiStatus,
  fetchWorkspaceChanges,
  createWorkspaceBranch,
  undoDiscardSession,
} from '@agentctl/api-client';
import { invalidateWorkspaceQueries } from '@/shared/lib/workspaceQueries';
import { sessionKeys } from '@/shared/lib/queryKeys';
import { toast } from 'sonner';

function combineDetails(results: UseQueryResult<ReviewFileItem | undefined>[]) {
  return results.map(({ data, isError }) => ({ data, isError }));
}

export function ReviewView() {
  const openWorkspaceFile = useOpenWorkspaceFile();
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
    pushChanges,
    pullChanges,
    isStagingAll,
    isUnstagingAll,

    sessionData,
    branches,
    switchBranch,
    mergeSession: onMerge,
    discardSession: onDiscard,
    isDiscardingSession: isDiscarding,
  } = useSession();

  const { events } = useSessionStream();

  useEffect(() => {
    refetchReview();
  }, [refetchReview]);

  const summaryFiles = reviewData.files;
  const sessionStatus = sessionData?.session.status;

  const onStage = stageFile;
  const onUnstage = unstageFile;
  const onRevert = revertFile;
  const onStageAll = stageAll;
  const onUnstageAll = unstageAll;
  const { state, dispatch, toggleFileCollapse, expandAll, collapseAll } = useReviewViewState();

  const sessionId = sessionData?.session.id ?? '';
  const queryClient = useQueryClient();
  const [visibleFiles, setVisibleFiles] = useState(new Set<string>());
  const onVisibleExpandedFilesChange = useCallback((paths: string[]) => {
    setVisibleFiles((previous) =>
      previous.size === paths.length && paths.every((path) => previous.has(path))
        ? previous
        : new Set(paths),
    );
  }, []);
  const reviewScope = useReviewUIStore((s) => s.reviewScope);
  const capture = reviewData.capture;
  const fromRevision = reviewScope === 'all_edits' ? capture?.baseline : capture?.working;
  const toRevision = capture?.current;
  const detailFiles = useMemo(
    () =>
      summaryFiles.filter(
        (file) =>
          (visibleFiles.has(file.path) && state.collapsedFiles[file.path] === false) ||
          !!state.searchQuery,
      ),
    [summaryFiles, visibleFiles, state.collapsedFiles, state.searchQuery],
  );
  const detailQueries = useQueries({
    queries: detailFiles.map((file) => ({
      queryKey: sessionKeys.reviewFile(sessionId, file.path, fromRevision, toRevision),
      enabled: !!sessionId && !!capture,
      queryFn: async ({ signal }) => {
        const response = await api.getRepositoryReview({
          params: { id: sessionId },
          fetchOptions: { signal },
          query: {
            filePath: file.path,
            fromRevision,
            toRevision,
            // Last Turn filters the live review by touched files. Only Branch
            // Changes compares their contents against the session baseline.
            scope: reviewScope === 'all_edits' ? 'session' : 'working',
          },
        });
        assertApiStatus(response, 200, 'Failed to load file diff');
        return response.body.files[0];
      },
      staleTime: Infinity,
    })),
    combine: combineDetails,
  });
  const files = useMemo(() => {
    const details = new Map(detailFiles.map((file, index) => [file.path, detailQueries[index]]));
    return summaryFiles.map((file) => {
      const detail = details.get(file.path);
      return {
        ...file,
        additions:
          reviewScope === 'all_edits' ? (file.sessionAdditions ?? file.additions) : file.additions,
        deletions:
          reviewScope === 'all_edits' ? (file.sessionDeletions ?? file.deletions) : file.deletions,
        diff: detail?.isError
          ? 'Could not load diff. Refresh the review to retry.'
          : detail?.data
            ? detail.data.diff || 'No textual changes in this scope.'
            : file.diff,
      };
    });
  }, [summaryFiles, detailFiles, detailQueries, reviewScope]);
  const invalidateWorkspace = () => invalidateWorkspaceQueries(queryClient, sessionId, 'session');
  const undoDiscard = useMutation({
    mutationFn: async () => {
      await undoDiscardSession(sessionId);
    },
    onSuccess: invalidateWorkspace,
  });
  const fetchChanges = async () => {
    try {
      await fetchWorkspaceChanges(sessionId);
    } finally {
      invalidateWorkspace();
    }
  };
  const createBranch = async (name: string) => {
    try {
      await createWorkspaceBranch(sessionId, name);
    } finally {
      invalidateWorkspace();
    }
  };
  const safeAction = async (operation: () => Promise<void>) => {
    try {
      await operation();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };
  const selectedTurn = useReviewUIStore((s) => s.reviewTurnSelection);
  const setReviewScope = useReviewUIStore((s) => s.setReviewScope);
  const targetReviewFile = useReviewUIStore((s) => s.targetReviewFile);
  const setTargetReviewFile = useReviewUIStore((s) => s.setTargetReviewFile);
  const onTargetFileHandled = useCallback(() => setTargetReviewFile(null), [setTargetReviewFile]);

  const handleScopeChange = useCallback(
    (newScope: ReviewScope) => {
      setReviewScope(newScope);
    },
    [setReviewScope],
  );

  const latestTurnTouchedFiles = useMemo(() => extractLatestTurnTouchedFiles(events), [events]);
  const latestTurnFiles = useMemo(
    () => resolveTurnReviewFiles(files, latestTurnTouchedFiles),
    [files, latestTurnTouchedFiles],
  );
  const selectedTurnFiles =
    selectedTurn && selectedTurn.sessionId === sessionData?.session.id ? selectedTurn.files : null;
  const activeTurnFiles = useMemo(
    () => (selectedTurnFiles ? new Set(selectedTurnFiles) : latestTurnFiles),
    [latestTurnFiles, selectedTurnFiles],
  );

  const scopeCounts = useMemo(() => {
    const uncommitted = files.filter((f) => f.state !== 'committed').length;
    const allEdits = files.length;
    return {
      uncommitted,
      this_turn: activeTurnFiles.size,
      all_edits: allEdits,
    };
  }, [activeTurnFiles, files]);

  const { activeFiles, parsedFiles, fileStats } = useReviewDiffs(
    files,
    state.searchQuery,
    reviewScope,
    activeTurnFiles,
    state.statusFilter,
    visibleFiles,
    state.collapsedFiles,
  );

  useLayoutEffect(() => {
    if (!targetReviewFile) return;
    dispatch({ type: 'EXPAND_FILE', filePath: targetReviewFile });
  }, [dispatch, targetReviewFile]);

  const activeFileIndexRef = useRef<number>(-1);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (
        activeEl instanceof HTMLInputElement ||
        activeEl instanceof HTMLTextAreaElement ||
        activeEl?.getAttribute('contenteditable') === 'true'
      ) {
        return;
      }

      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (parsedFiles.length === 0) return;

      if (e.key === 'j' || e.key === ']') {
        e.preventDefault();
        const next =
          activeFileIndexRef.current + 1 >= parsedFiles.length ? 0 : activeFileIndexRef.current + 1;
        activeFileIndexRef.current = next;
        const target = parsedFiles[next];
        if (target) {
          dispatch({ type: 'EXPAND_FILE', filePath: target.path });
          setTargetReviewFile(target.path);
        }
      } else if (e.key === 'k' || e.key === '[') {
        e.preventDefault();
        const next =
          activeFileIndexRef.current - 1 < 0
            ? parsedFiles.length - 1
            : activeFileIndexRef.current - 1;
        activeFileIndexRef.current = next;
        const target = parsedFiles[next];
        if (target) {
          dispatch({ type: 'EXPAND_FILE', filePath: target.path });
          setTargetReviewFile(target.path);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [parsedFiles, dispatch, setTargetReviewFile]);

  const isClosed = sessionStatus === 'merged' || sessionStatus === 'discarded';

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

  const stagedCount = files.filter(
    (file) => file.hasStagedChanges ?? file.state === 'staged',
  ).length;
  const uncommittedCount = files.filter((file) => file.state !== 'committed').length;
  const unstagedCount = files.filter(
    (file) => file.hasUnstagedChanges ?? !['staged', 'committed'].includes(file.state),
  ).length;
  const changeStats = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    for (const file of summaryFiles) {
      if (file.state === 'committed') continue;
      if (file.additions !== undefined && file.deletions !== undefined) {
        additions += file.additions;
        deletions += file.deletions;
        continue;
      }
      for (const line of file.diff?.split('\n') ?? []) {
        if (line.startsWith('+') && !line.startsWith('+++')) additions += 1;
        if (line.startsWith('-') && !line.startsWith('---')) deletions += 1;
      }
    }
    return { additions, deletions };
  }, [summaryFiles]);
  const { gitStatus, isLoading: isLoadingGitStatus } = useGitStatus(sessionData?.session.id ?? '');
  const baseBranch = sessionData?.session.baseBranch ?? 'main';
  const canPush =
    gitStatus.isRepo &&
    gitStatus.hasPrimaryRemote &&
    gitStatus.branch !== null &&
    gitStatus.branch !== 'HEAD';

  const pullRequestBlockedReason = useMemo(() => {
    if (!gitStatus.isRepo) return gitStatus.error ?? 'This workspace is not a Git repository';
    if (!gitStatus.branch || gitStatus.branch === 'HEAD')
      return 'Check out a branch before creating a pull request';
    if (!gitStatus.hasPrimaryRemote) return 'Configure a Git remote before creating a pull request';
    if (gitStatus.remoteProvider !== 'github')
      return 'Pull request creation currently supports GitHub remotes only';
    return undefined;
  }, [gitStatus]);

  const gitActions = (
    <ReviewGitActions
      sessionId={sessionData?.session.id ?? ''}
      baseBranch={baseBranch}
      mode={sessionData?.session.mode ?? 'local'}
      branch={gitStatus.branch}
      branches={branches}
      hasBranchChanges={files.length > 0}
      stagedCount={stagedCount}
      unstagedCount={unstagedCount}
      uncommittedCount={uncommittedCount}
      additions={changeStats.additions}
      deletions={changeStats.deletions}
      aheadCount={gitStatus.aheadCount}
      behindCount={gitStatus.behindCount}
      hasUpstream={gitStatus.hasUpstream}
      isBaseBranch={gitStatus.branch === baseBranch}
      canPush={canPush}
      isLoadingGitStatus={isLoadingGitStatus}
      commitMessage={state.commitMessage}
      onCommitMessageChange={(value) => {
        dispatch({ type: 'SET_COMMIT_MESSAGE', payload: value });
      }}
      onSwitchBranch={switchBranch}
      onCommit={async (message, includeUnstaged) => {
        await onCommitChanges(message, includeUnstaged);
        dispatch({ type: 'SET_COMMIT_MESSAGE', payload: '' });
      }}
      onFetch={fetchChanges}
      onCreateBranch={createBranch}
      lastFetchedAt={gitStatus.lastFetchedAt}
      workspaceBusy={!canMutateWorkspace(sessionStatus)}
      onPush={async () => {
        await pushChanges();
      }}
      onPull={async () => {
        await pullChanges();
      }}
      onOpenPullRequestDialog={() => {
        dispatch({ type: 'SET_PR_DIALOG_OPEN', payload: true });
      }}
      existingPullRequest={
        gitStatus.pr?.state === 'open'
          ? { number: gitStatus.pr.number, url: gitStatus.pr.url }
          : undefined
      }
      pullRequestBlockedReason={pullRequestBlockedReason}
      onApplySession={() => {
        dispatch({ type: 'SET_APPLY_DIALOG_OPEN', payload: true });
      }}
      onDiscardChanges={() => {
        dispatch({ type: 'SET_DISCARD_MODAL_OPEN', payload: true });
      }}
    />
  );

  const hasUnstaged = useMemo(
    () =>
      files.some(
        (f) => f.hasUnstagedChanges ?? ['modified', 'untracked', 'deleted'].includes(f.state),
      ),
    [files],
  );
  const hasStaged = useMemo(
    () => files.some((f) => f.hasStagedChanges ?? f.state === 'staged'),
    [files],
  );

  const handleSelectFile = useCallback(
    (filePath: string) => {
      dispatch({ type: 'EXPAND_FILE', filePath });
      setTargetReviewFile(filePath);
    },
    [dispatch, setTargetReviewFile],
  );

  if (isClosed)
    return (
      <ReviewClosedState
        sessionStatus={sessionStatus}
        baseBranch={baseBranch}
        mode={sessionData?.session.mode}
        canRecover={sessionStatus === 'discarded' && !!sessionData?.session.discardBackup}
        isRecovering={undoDiscard.isPending}
        onRecover={() => {
          void safeAction(() => undoDiscard.mutateAsync());
        }}
      />
    );

  return (
    <div className="bg-surface/50 relative flex h-full flex-col overflow-hidden">
      <ReviewHeader
        files={activeFiles}
        scope={reviewScope}
        onScopeChange={handleScopeChange}
        scopeCounts={scopeCounts}
        viewMode={state.viewMode}
        wrapLines={state.wrapLines}
        onToggleWrapLines={() => dispatch({ type: 'TOGGLE_WRAP_LINES' })}
        onToggleViewMode={() => {
          dispatch({ type: 'TOGGLE_VIEW_MODE' });
        }}
        searchQuery={state.searchQuery}
        onSearchChange={(q) => {
          dispatch({ type: 'SET_SEARCH_QUERY', payload: q });
        }}
        allCollapsed={allCollapsed}
        onToggleAll={onToggleAll}
        gitActions={gitActions}
        onSelectFile={handleSelectFile}
        fileStats={fileStats}
        onStageAll={() => {
          void safeAction(() => onStageAll());
        }}
        onUnstageAll={() => {
          void safeAction(() => onUnstageAll());
        }}
        hasUnstaged={hasUnstaged}
        hasStaged={hasStaged}
        isStagingAll={isStagingAll}
        isUnstagingAll={isUnstagingAll}
        statusFilter={state.statusFilter}
        onStatusFilterChange={(filter) => {
          dispatch({ type: 'SET_STATUS_FILTER', payload: filter });
        }}
      />

      {/* Main Review Content Area */}
      {isLoading ? (
        <ReviewLoadingState />
      ) : sessionStatus === 'archived' ? (
        <ReviewClosedState sessionStatus={sessionStatus} />
      ) : activeFiles.length === 0 ? (
        <ReviewEmptyState
          searchQuery={state.searchQuery}
          unavailable={reviewData.repository?.capabilities.review === false}
        />
      ) : (
        <ReviewFileList
          files={parsedFiles}
          collapsedFiles={state.collapsedFiles}
          onToggleFile={(p) => {
            toggleFileCollapse(p);
          }}
          viewMode={state.viewMode}
          wrapLines={state.wrapLines}
          fileStats={fileStats}
          onStage={(p) => {
            void safeAction(() => onStage(p));
          }}
          onUnstage={(p) => {
            void safeAction(() => onUnstage(p));
          }}
          onRevert={(p) => {
            void safeAction(() => onRevert(p));
          }}
          onOpenFile={(p) => {
            void openWorkspaceFile(p);
          }}
          targetFilePath={targetReviewFile}
          onTargetFileHandled={onTargetFileHandled}
          onVisibleExpandedFilesChange={onVisibleExpandedFilesChange}
        />
      )}

      <ReviewDialogs
        sessionId={sessionData?.session.id ?? ''}
        branches={branches}
        mode={sessionData?.session.mode ?? 'local'}
        uncommittedCount={uncommittedCount}
        workspaceBusy={!canMutateWorkspace(sessionStatus)}
        defaultMessage={sessionData?.session.title || sessionData?.session.taskSlug}
        onCommitAll={async (message) => {
          await onCommitChanges(message, true);
        }}
        isDiscardModalOpen={state.isDiscardModalOpen}
        isApplyDialogOpen={state.isApplyDialogOpen}
        isPullRequestDialogOpen={state.isPullRequestDialogOpen}
        commitMessage={state.commitMessage}
        isDiscarding={isDiscarding}
        defaultTitle={sessionData?.session.title ?? ''}
        defaultBaseBranch={baseBranch}
        currentBranch={gitStatus.branch ?? sessionData?.session.branch ?? ''}
        onCloseDiscardModal={() => {
          dispatch({ type: 'SET_DISCARD_MODAL_OPEN', payload: false });
        }}
        onConfirmDiscard={async () => {
          try {
            await onDiscard();
            dispatch({ type: 'SET_DISCARD_MODAL_OPEN', payload: false });
            toast.success('Session changes discarded');
          } catch (err) {
            toast.error(
              `Failed to discard changes: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }}
        onSetApplyDialogOpen={(open) => {
          dispatch({ type: 'SET_APPLY_DIALOG_OPEN', payload: open });
        }}
        onSetPullRequestDialogOpen={(open) => {
          dispatch({ type: 'SET_PR_DIALOG_OPEN', payload: open });
        }}
        onCommitMessageChange={(val) => {
          dispatch({ type: 'SET_COMMIT_MESSAGE', payload: val });
        }}
        onConfirmApply={async (message, targetBranch) => {
          await onMerge(message, targetBranch);
          toast.success(
            sessionData?.session.mode === 'worktree'
              ? `Merged to ${targetBranch ?? baseBranch}. Source worktree kept.`
              : 'Session finished',
          );
        }}
        onPullRequestSuccess={(url, status) => {
          toast.success(
            status === 'created'
              ? 'Pull request created'
              : status === 'already_exists'
                ? 'Branch pushed. Existing pull request updated.'
                : 'Branch pushed. Finish the PR on GitHub.',
            {
              action: {
                label: status === 'needs_browser' ? 'Continue on GitHub' : 'Open PR',
                onClick: () => {
                  window.open(url, '_blank');
                },
              },
            },
          );
        }}
      />
    </div>
  );
}
