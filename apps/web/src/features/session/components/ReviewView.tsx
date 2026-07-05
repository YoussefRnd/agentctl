import { useMemo, useCallback, Fragment, useState } from 'react';
import { DiffBlock } from './diff/DiffBlock';
import { parseDiff } from '../../../utils/diff-parser';
import { matchSorter } from 'match-sorter';
import { ConfirmationModal } from '@agentctl/ui';
import { ReviewHeader, type ReviewFile, type FileState } from './ReviewHeader';
import { ReviewMergeDialog } from './ReviewMergeDialog';
import { useReviewViewState } from '../hooks/useReviewViewState';
import {
  ReviewClosedState,
  ReviewErrorState,
  ReviewLoadingState,
  ReviewEmptyState,
} from './ReviewStates';
import type { LucideIcon } from 'lucide-react';
import {
  ChevronRight,
  ChevronDown,
  FilePlus,
  FileMinus,
  FileCode,
  Check,
  AlertTriangle,
} from 'lucide-react';

interface ReviewViewProps {
  files: ReviewFile[];
  isLoading?: boolean;
  error?: Error | null;
  onStage?: (filePath: string) => void;
  onUnstage?: (filePath: string) => void;
  onRevert?: (filePath: string) => void;
  onRetry?: () => void;
  sessionStatus?: string;
  taskSlug?: string;
  onMerge?: (commitMessage: string) => void;
  onDiscard?: () => void;
  isMerging?: boolean;
  isDiscarding?: boolean;
  onStageAll?: () => void;
  onUnstageAll?: () => void;
  onCommitChanges?: (message: string) => void;
  onPush?: () => void;
  onPull?: () => void;
  isPushing?: boolean;
  isPulling?: boolean;
  isCommitting?: boolean;
  isStagingAll?: boolean;
  isUnstagingAll?: boolean;
  sessionMode?: 'local' | 'worktree';
}

const stateIcons: Record<FileState, LucideIcon> = {
  untracked: FilePlus,
  staged: Check,
  modified: FileCode,
  deleted: FileMinus,
  committed: Check,
  conflicted: AlertTriangle,
};

const stateColorMini: Record<FileState, string> = {
  untracked: 'text-success/80',
  staged: 'text-accent/80',
  modified: 'text-warning/80',
  deleted: 'text-danger/80',
  committed: 'text-text-muted/40',
  conflicted: 'text-danger animate-pulse font-black',
};

export function ReviewView({
  files,
  isLoading,
  error,
  onStage,
  onUnstage,
  onRevert,
  onRetry,
  sessionStatus,
  taskSlug,
  onMerge,
  onDiscard,
  isMerging,
  isDiscarding,
  onStageAll,
  onUnstageAll,
  onCommitChanges,
  isCommitting,
  isStagingAll,
  isUnstagingAll,
  sessionMode,
}: ReviewViewProps) {
  const { state, dispatch, toggleFileCollapse, toggleSection, expandAll, collapseAll } =
    useReviewViewState();
  const [localCommitMessage, setLocalCommitMessage] = useState('');

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

  const activeFiles = useMemo(() => {
    return files.filter((f) => f.state !== 'committed');
  }, [files]);

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

  const handleMergeSubmit = () => {
    if (onMerge) onMerge(state.commitMessage);
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
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-boolean-literal-compare
    return parsedFiles.every((file) => state.collapsedFiles[file.path] !== false);
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
  if (error) return <ReviewErrorState error={error} onRetry={onRetry} />;

  return (
    <div className="bg-surface-secondary/5 flex h-full min-h-0 flex-col">
      <ReviewHeader
        files={activeFiles}
        isMerging={isMerging}
        isDiscarding={isDiscarding}
        onOpenMergeDialog={() => {
          dispatch({ type: 'RESET_COMMIT_MESSAGE', payload: taskSlug ?? 'implements features' });
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
      />

      {sessionMode === 'local' && (
        <div className="border-accent/15 bg-accent/5 text-text-main/80 mx-4 mt-3 flex flex-col gap-1.5 rounded border px-3 py-2.5 text-[10px] transition-all select-none">
          <div className="text-accent flex items-center gap-2 font-black tracking-widest uppercase">
            <span className="bg-accent inline-block h-1.5 w-1.5 rounded-full shadow-[0_0_8px_currentColor]" />
            Local Session Scope (Snapshot)
          </div>
          <div className="text-[9.5px] leading-relaxed opacity-90">
            Only changes made since this local session was initialized are shown and committed.
            Pre-existing untracked or modified changes in your repository are protected and
            preserved.
          </div>
        </div>
      )}

      {filteredFiles.length === 0 ? (
        <ReviewEmptyState searchQuery={state.searchQuery} />
      ) : (
        <div className="custom-scrollbar flex-1 overflow-y-auto">
          {(Object.keys(grouped) as FileState[]).map((fileState) => {
            const entries = grouped[fileState];
            if (entries.length === 0) return null;
            const isSectionCollapsed = state.collapsedSections[fileState];

            return (
              <Fragment key={fileState}>
                {/* Sticky section divider */}
                <div className="border-border/10 bg-surface-secondary/20 sticky top-0 z-10 flex w-full items-center justify-between border-y px-4 py-1.5 backdrop-blur-md">
                  <button
                    type="button"
                    onClick={() => {
                      toggleSection(fileState);
                    }}
                    className="flex cursor-pointer items-center gap-3 transition-opacity hover:opacity-80"
                  >
                    <div
                      className={`h-1.5 w-1.5 rounded-full ${fileState === 'modified' ? 'bg-warning' : fileState === 'deleted' ? 'bg-danger' : fileState === 'staged' ? 'bg-success' : fileState === 'conflicted' ? 'bg-danger animate-pulse' : 'bg-accent'} opacity-60 shadow-[0_0_8px_currentColor]`}
                    />
                    <span className="text-text-muted/40 text-[10px] font-black tracking-[0.2em] uppercase">
                      {fileState}
                    </span>
                    <span className="text-text-muted/20 text-[9px] font-black tabular-nums">
                      {entries.length}
                    </span>
                    <div className="text-text-muted/20">
                      {isSectionCollapsed ? (
                        <ChevronRight className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" />
                      )}
                    </div>
                  </button>

                  {/* Contextual staging actions */}
                  {fileState === 'staged' && onUnstageAll && (
                    <button
                      type="button"
                      disabled={isUnstagingAll}
                      onClick={(e) => {
                        e.stopPropagation();
                        onUnstageAll();
                      }}
                      className="text-accent hover:text-accent/80 cursor-pointer text-[8px] font-black tracking-wider uppercase transition-colors disabled:opacity-40"
                    >
                      {isUnstagingAll ? 'Unstaging...' : 'Unstage All'}
                    </button>
                  )}
                  {(fileState === 'modified' || fileState === 'untracked') && onStageAll && (
                    <button
                      type="button"
                      disabled={isStagingAll}
                      onClick={(e) => {
                        e.stopPropagation();
                        onStageAll();
                      }}
                      className="text-accent hover:text-accent/80 cursor-pointer text-[8px] font-black tracking-wider uppercase transition-colors disabled:opacity-40"
                    >
                      {isStagingAll ? 'Staging...' : 'Stage All'}
                    </button>
                  )}
                </div>

                {!isSectionCollapsed &&
                  entries.map((file) => {
                    const collapsed = state.collapsedFiles[file.path] ?? true;
                    const FileStateIcon = stateIcons[file.state];
                    const stats = fileStats.get(file.path) ?? { additions: 0, deletions: 0 };
                    const fileName = file.path.split('/').pop() ?? file.path;
                    const dirPath = file.path.split('/').slice(0, -1).join('/');

                    return (
                      <div key={`${fileState}:${file.path}`} id={`diff-block-${file.path}`}>
                        {/* Compact file row */}
                        <div
                          className={`border-border/5 flex w-full items-center gap-3 border-b px-4 py-2.5 transition-colors ${
                            !collapsed
                              ? 'bg-surface-secondary/10 border-l-accent/30 border-l-2'
                              : 'hover:bg-surface-secondary/15'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              toggleFileCollapse(file.path);
                            }}
                            className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 border-0 bg-transparent p-0 text-left"
                          >
                            <FileStateIcon
                              className={`h-3.5 w-3.5 shrink-0 ${stateColorMini[file.state]}`}
                            />
                            <div className="flex min-w-0 flex-1 flex-col">
                              <span className="text-text-main/80 truncate font-mono text-[11px] font-bold">
                                {fileName}
                              </span>
                              {dirPath && (
                                <span className="text-text-muted/20 truncate font-mono text-[8px] tracking-tighter">
                                  {dirPath}/
                                </span>
                              )}
                            </div>
                          </button>

                          <div className="flex shrink-0 items-center gap-1.5 font-mono text-[8px] font-bold">
                            {stats.additions > 0 && (
                              <span className="text-success/80">+{stats.additions}</span>
                            )}
                            {stats.deletions > 0 && (
                              <span className="text-danger/80">-{stats.deletions}</span>
                            )}
                          </div>

                          {onStage && (file.state === 'modified' || file.state === 'untracked') && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onStage(file.path);
                              }}
                              className="bg-accent/15 text-accent/80 hover:bg-accent/25 h-5 shrink-0 cursor-pointer rounded px-1.5 text-[7px] font-black tracking-wider uppercase transition-colors"
                            >
                              Stage
                            </button>
                          )}
                          {onUnstage && file.state === 'staged' && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onUnstage(file.path);
                              }}
                              className="bg-accent/15 text-accent/80 hover:bg-accent/25 h-5 shrink-0 cursor-pointer rounded px-1.5 text-[7px] font-black tracking-wider uppercase transition-colors"
                            >
                              Unstage
                            </button>
                          )}
                          {onRevert &&
                            (file.state === 'modified' ||
                              file.state === 'deleted' ||
                              file.state === 'staged') && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onRevert(file.path);
                                }}
                                className="bg-danger/10 text-danger/70 hover:bg-danger/20 h-5 shrink-0 cursor-pointer rounded px-1.5 text-[7px] font-black tracking-wider uppercase transition-colors"
                              >
                                Revert
                              </button>
                            )}

                          <button
                            type="button"
                            onClick={() => {
                              toggleFileCollapse(file.path);
                            }}
                            className="text-text-muted/20 hover:text-text-muted/50 cursor-pointer border-0 bg-transparent p-0 transition-colors"
                          >
                            {collapsed ? (
                              <ChevronRight className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronDown className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </div>

                        {/* Expanded diff content */}
                        {!collapsed && (
                          <div className="border-border/5 bg-surface-secondary/5 border-b">
                            <DiffBlock
                              path={file.path}
                              hunks={file.hunks}
                              isCollapsed={false}
                              viewMode={state.viewMode}
                              showHeader={false}
                              onStage={
                                onStage && (file.state === 'modified' || file.state === 'untracked')
                                  ? () => {
                                      onStage(file.path);
                                    }
                                  : undefined
                              }
                              onRevert={
                                onRevert && (file.state === 'modified' || file.state === 'deleted')
                                  ? () => {
                                      onRevert(file.path);
                                    }
                                  : undefined
                              }
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
              </Fragment>
            );
          })}
        </div>
      )}

      {/* Pinned Local Commit Input Box */}
      {grouped.staged.length > 0 && onCommitChanges && (
        <div className="border-border/10 bg-surface-secondary/15 shrink-0 space-y-3 border-t p-4">
          <div className="flex items-center justify-between">
            <span className="text-text-muted/65 text-[8px] font-black tracking-widest uppercase select-none">
              Local Commit
            </span>
            <span className="text-text-muted/40 text-[8.5px] font-bold uppercase">
              {grouped.staged.length} file{grouped.staged.length > 1 ? 's' : ''} staged
            </span>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={localCommitMessage}
              onChange={(e) => {
                setLocalCommitMessage(e.target.value);
              }}
              placeholder="Commit message (lowercase)..."
              aria-label="Commit message"
              className="border-border/15 bg-surface/20 text-text-main placeholder:text-text-muted/30 focus:border-accent/40 flex-1 rounded-md border px-3 py-1.5 text-[11px] font-bold transition-all outline-none focus:ring-0"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && localCommitMessage.trim() && !isCommitting) {
                  e.preventDefault();
                  onCommitChanges(localCommitMessage);
                  setLocalCommitMessage('');
                }
              }}
            />
            <button
              type="button"
              disabled={!localCommitMessage.trim() || isCommitting}
              onClick={() => {
                onCommitChanges(localCommitMessage);
                setLocalCommitMessage('');
              }}
              className="bg-accent text-brand-crust h-[30px] shrink-0 cursor-pointer rounded-md px-3.5 text-[9px] font-black tracking-widest uppercase transition-all hover:opacity-90 disabled:opacity-30"
            >
              {isCommitting ? 'Committing...' : 'Commit'}
            </button>
          </div>
        </div>
      )}

      <ConfirmationModal
        isOpen={state.isDiscardModalOpen}
        title="Discard all changes?"
        message="This will permanently revert all modifications in this workspace. This action cannot be undone."
        confirmText="Discard Changes"
        cancelText="Cancel"
        type="brand-red"
        onConfirm={() => {
          if (onDiscard) onDiscard();
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
