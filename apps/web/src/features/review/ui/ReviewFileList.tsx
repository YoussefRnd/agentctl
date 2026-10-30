import {
  ChevronRightIcon,
  ChevronDownIcon,
  LinkExternalIcon,
  PlusIcon,
  DashIcon,
  UndoIcon,
  CommentIcon,
  KebabHorizontalIcon,
} from '@primer/octicons-react';
import { useMemo, useRef, useLayoutEffect, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { CodeReviewFinding } from './CodeReviewFinding';
import type { CodeReviewRun, ResolveReviewFinding } from '@agentctl/shared';
import { DiffBlock } from './diff/DiffBlock';
import type { ReviewFile, FileState } from './ReviewHeader';

import { Dropdown, cn } from '@agentctl/ui';
import { toast } from 'sonner';
import type { parseDiff } from '@/shared/lib/diff-parser';
import { FileIcon } from '@/shared';
import type { ReviewComposerActions } from '../model/composer-actions';

const STATE_BADGE: Record<FileState, { letter: string; color: string; label: string }> = {
  modified: {
    letter: 'M',
    color: 'text-amber-400',
    label: 'Modified',
  },
  untracked: {
    letter: 'U',
    color: 'text-emerald-400',
    label: 'Untracked',
  },
  staged: {
    letter: 'S',
    color: 'text-emerald-400',
    label: 'Staged',
  },
  deleted: {
    letter: 'D',
    color: 'text-rose-400',
    label: 'Deleted',
  },
  conflicted: {
    letter: '!',
    color: 'text-rose-400 animate-pulse',
    label: 'Conflicted',
  },
  committed: {
    letter: 'C',
    color: 'text-text-muted',
    label: 'Committed',
  },
};

export interface ReviewFileListProps {
  sessionId?: string;
  codeReview?: CodeReviewRun;
  resolvingFinding?: boolean;
  findingError?: string;
  onResolveFinding?(findingId: string, body: ResolveReviewFinding): Promise<unknown>;

  composerActions: ReviewComposerActions;
  files?: (ReviewFile & { hunks: ReturnType<typeof parseDiff> })[];
  collapsedFiles: Record<string, boolean>;
  fileStats: Map<string, { additions: number; deletions: number }>;
  viewMode: 'inline' | 'split';
  wrapLines?: boolean;
  onToggleFile: (path: string) => void;
  onStage?: (path: string) => void;
  onUnstage?: (path: string) => void;
  onRevert?: (path: string) => void;
  onOpenFile?: (path: string) => void;
  targetFilePath?: string | null;
  targetFileRef?: (element: HTMLDivElement | null) => void;
  onTargetFileHandled?: () => void;
  onVisibleExpandedFilesChange?: (paths: string[]) => void;
}

export function ReviewFileList({
  sessionId,
  codeReview,
  resolvingFinding,
  findingError,
  onResolveFinding,
  composerActions,
  files,
  collapsedFiles,
  fileStats,
  viewMode,
  wrapLines = false,
  onToggleFile,
  onStage,
  onUnstage,
  onRevert,
  onOpenFile,
  targetFilePath,
  targetFileRef,
  onTargetFileHandled,
  onVisibleExpandedFilesChange,
}: ReviewFileListProps) {
  const annotations = useMemo(() => {
    const result = new Map<string, Map<string, ReactNode>>();
    if (!sessionId || !codeReview || !onResolveFinding) return result;
    for (const file of files ?? []) {
      const findings = codeReview.findings.filter(
        (finding) => finding.path === file.path && finding.status === 'open',
      );
      const lines = new Map<string, ReactNode>();
      const oldSide = !file.hunks.some((hunk) =>
        hunk.lines.some((line) => line.newLineNumber !== undefined),
      );
      for (const line of new Set(findings.map((finding) => finding.line))) {
        lines.set(
          `${oldSide ? 'old' : 'new'}:${line}`,
          <div className="space-y-2 text-xs">
            <p className="text-text-muted text-[11px]">AI findings · matching review version</p>
            <ul className="space-y-2">
              {findings
                .filter((finding) => finding.line === line)
                .map((finding) => (
                  <CodeReviewFinding
                    key={finding.id}
                    finding={finding}
                    sessionId={sessionId}
                    reviewId={codeReview.id}
                    showExcerpt={false}
                    composerActions={composerActions}
                    pending={!!resolvingFinding}
                    onSelectFile={() => onOpenFile?.(file.path)}
                    onResolve={(body) => onResolveFinding(finding.id, body)}
                  />
                ))}
            </ul>
            {findingError && (
              <p role="alert" className="text-danger [overflow-wrap:anywhere]">
                {findingError}
              </p>
            )}
          </div>,
        );
      }
      result.set(file.path, lines);
    }
    return result;
  }, [
    files,
    sessionId,
    codeReview,
    resolvingFinding,
    findingError,
    onResolveFinding,
    onOpenFile,
    composerActions,
  ]);
  const allFiles = useMemo(() => files ?? [], [files]);

  const parentRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<HTMLDivElement | null>(null);
  const virtualized = allFiles.length > 1;
  const virtualizer = useVirtualizer({
    count: allFiles.length,
    getScrollElement: () => parentRef.current,
    getItemKey: (index) => {
      const file = allFiles[index];
      return `${file.path}:${collapsedFiles[file.path] === false ? 'expanded' : 'collapsed'}`;
    },
    estimateSize: (index) => {
      const file = allFiles[index];
      const stats = fileStats.get(file.path);
      return collapsedFiles[file.path] === false
        ? 84 + ((stats?.additions ?? 0) + (stats?.deletions ?? 0)) * 18
        : 52;
    },
    overscan: 1,
    enabled: virtualized,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const visibleFiles = useMemo(
    () => (virtualized ? virtualItems.map((item) => allFiles[item.index]) : allFiles),
    [virtualized, virtualItems, allFiles],
  );
  useLayoutEffect(() => {
    // Measure refs first, then request only expanded files in the current range.
    // Cached heights for off-screen files remain intact across layout changes.
    const currentFiles = virtualized
      ? virtualizer.getVirtualItems().map((item) => allFiles[item.index])
      : allFiles;
    onVisibleExpandedFilesChange?.(
      currentFiles.filter((file) => collapsedFiles[file.path] === false).map((file) => file.path),
    );
  }, [
    visibleFiles,
    onVisibleExpandedFilesChange,
    virtualizer,
    virtualized,
    allFiles,
    collapsedFiles,
  ]);
  useLayoutEffect(() => {
    if (!targetFilePath) return;
    const index = allFiles.findIndex((file) => file.path === targetFilePath);
    if (index < 0) return;
    if (virtualized) virtualizer.scrollToIndex(index, { align: 'start' });
    else targetRef.current?.scrollIntoView?.({ block: 'start' });
    if (
      visibleFiles.some((file) => file.path === targetFilePath) &&
      collapsedFiles[targetFilePath] === false
    ) {
      onTargetFileHandled?.();
    }
  }, [
    targetFilePath,
    allFiles,
    visibleFiles,
    collapsedFiles,
    virtualizer,
    virtualized,
    onTargetFileHandled,
  ]);

  if (allFiles.length === 0) return null;

  return (
    <div
      ref={parentRef}
      data-review-scroll
      className="custom-scrollbar min-h-0 flex-1 overflow-y-auto"
    >
      <div
        className="relative w-full"
        style={{ height: virtualized ? virtualizer.getTotalSize() : undefined }}
      >
        {visibleFiles.map((file, visibleIndex) => {
          const item = virtualized ? virtualItems[visibleIndex] : undefined;
          const collapsed = collapsedFiles[file.path] ?? true;
          const stats = fileStats.get(file.path) ?? { additions: 0, deletions: 0 };
          const fileName = file.path.split('/').pop() ?? file.path;
          const dirPath = file.path.split('/').slice(0, -1).join('/');
          const canStage = Boolean(
            onStage && (file.hasUnstagedChanges ?? !['staged', 'committed'].includes(file.state)),
          );
          const canUnstage = Boolean(
            onUnstage && (file.hasStagedChanges ?? file.state === 'staged'),
          );
          const badge = STATE_BADGE[file.state] ?? STATE_BADGE.modified;

          return (
            <div
              key={file.path}
              data-review-file={file.path}
              data-index={item?.index}
              style={{
                minHeight:
                  !collapsed && file.hunks.length === 0 && !file.diff
                    ? 84 + (stats.additions + stats.deletions) * 18
                    : undefined,
                ...(item
                  ? {
                      position: 'absolute',
                      top: item.start,
                      left: 0,
                      width: '100%',
                    }
                  : {}),
              }}
              ref={(element) => {
                if (virtualized) virtualizer.measureElement(element);
                if (file.path === targetFilePath) {
                  targetRef.current = element;
                  targetFileRef?.(element);
                }
              }}
              className="border-border/10 border-b"
            >
              {/* Sticky File Header: docks to top while scrolling through diff */}
              <div
                className={cn(
                  'group/filerow border-border/20 bg-surface sticky top-0 z-10 flex w-full items-center justify-between border-b transition-colors',
                  !collapsed
                    ? 'border-l-accent/80 bg-surface-secondary border-l-2 shadow-xs'
                    : 'hover:bg-surface-secondary/25',
                )}
              >
                <button
                  type="button"
                  title={file.path}
                  aria-label={`Toggle diff for ${file.path}`}
                  aria-expanded={!collapsed}
                  onClick={() => {
                    onToggleFile(file.path);
                  }}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-3 py-2 text-left select-none"
                >
                  {/* Single Slot: FileIcon at rest, Chevron replaces it on row hover */}
                  <div className="relative flex h-4 w-4 shrink-0 items-center justify-center">
                    <span className="transition-opacity duration-150 group-hover/filerow:opacity-0">
                      <FileIcon path={file.path} className="h-3.5 w-3.5" />
                    </span>
                    <span className="text-text-muted absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-150 group-hover/filerow:opacity-100">
                      {collapsed ? (
                        <ChevronRightIcon className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronDownIcon className="h-3.5 w-3.5" />
                      )}
                    </span>
                  </div>

                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-text-main truncate font-mono text-xs font-medium">
                      {fileName}
                    </span>
                    {dirPath && (
                      <span className="text-text-muted/50 truncate font-mono text-[10px]">
                        {dirPath}/
                      </span>
                    )}
                  </span>
                </button>

                <div className="flex shrink-0 items-center gap-2 pr-3 select-none">
                  {(canStage || canUnstage) && (
                    <button
                      type="button"
                      aria-label={canStage ? 'Stage file' : 'Unstage file'}
                      title={`${canStage ? 'Stage' : 'Unstage'} ${file.path}`}
                      onClick={() => (canStage ? onStage?.(file.path) : onUnstage?.(file.path))}
                      className="border-accent/20 text-accent hover:bg-accent/15 flex h-6 cursor-pointer items-center gap-1 rounded-md border px-1.5 text-[10px] font-medium transition-colors"
                    >
                      {canStage ? (
                        <PlusIcon className="h-3 w-3" />
                      ) : (
                        <DashIcon className="h-3 w-3" />
                      )}
                      {canStage ? 'Stage' : 'Unstage'}
                    </button>
                  )}
                  <Dropdown.Root>
                    <Dropdown.Trigger asChild>
                      <button
                        type="button"
                        aria-label={`More actions for ${file.path}`}
                        className="text-text-muted hover:text-text-main hover:bg-surface-secondary flex h-6 w-6 cursor-pointer items-center justify-center rounded-md"
                      >
                        <KebabHorizontalIcon className="h-3.5 w-3.5" />
                      </button>
                    </Dropdown.Trigger>
                    <Dropdown.Portal>
                      <Dropdown.Content align="end" className="min-w-44">
                        {onOpenFile && (
                          <Dropdown.Item onSelect={() => onOpenFile(file.path)} className="gap-2">
                            <LinkExternalIcon className="h-3.5 w-3.5" />
                            Open in editor
                          </Dropdown.Item>
                        )}
                        <Dropdown.Item
                          className="gap-2"
                          onSelect={() => {
                            composerActions.attachContextToComposer({
                              id: `file:${file.path}`,
                              type: 'file',
                              title: fileName,
                              subtitle: file.path,
                              value: file.path,
                            });
                            toast.success(`Added @${fileName} to chat`);
                          }}
                        >
                          <CommentIcon className="h-3.5 w-3.5" />
                          Add to chat
                        </Dropdown.Item>
                        {canStage && canUnstage && (
                          <Dropdown.Item onSelect={() => onUnstage?.(file.path)} className="gap-2">
                            <DashIcon className="h-3.5 w-3.5" />
                            Unstage file
                          </Dropdown.Item>
                        )}
                        {onRevert && file.state !== 'committed' && (
                          <>
                            <Dropdown.Separator />
                            <Dropdown.Item
                              onSelect={() => onRevert(file.path)}
                              className="gap-2 text-rose-400 focus-visible:bg-rose-500/10"
                            >
                              <UndoIcon className="h-3.5 w-3.5" />
                              Discard file changes
                            </Dropdown.Item>
                          </>
                        )}
                      </Dropdown.Content>
                    </Dropdown.Portal>
                  </Dropdown.Root>

                  {/* Diff Line Stats (+N / -N) */}
                  {(stats.additions > 0 || stats.deletions > 0) && (
                    <div className="flex shrink-0 items-center gap-1 font-mono text-[10.5px] font-semibold tabular-nums">
                      {stats.additions > 0 && (
                        <span className="text-emerald-400">+{stats.additions}</span>
                      )}
                      {stats.deletions > 0 && (
                        <span className="text-rose-400">-{stats.deletions}</span>
                      )}
                    </div>
                  )}

                  {/* Status Letter: Placed at MAX RIGHT (VS Code Style) */}
                  <span
                    className={cn(
                      'w-3.5 shrink-0 text-center font-mono text-xs font-bold select-none',
                      badge.color,
                    )}
                    title={`Status: ${badge.label}`}
                  >
                    {badge.letter}
                  </span>
                </div>
              </div>

              {/* Diff content when expanded */}
              {!collapsed && (
                <div className="bg-surface/10">
                  {file.hunks.length === 0 && (
                    <p className="text-text-muted p-3 text-xs">{file.diff || 'Loading diff…'}</p>
                  )}
                  {file.hasStagedChanges && file.hasUnstagedChanges && (
                    <p className="text-text-muted p-2 text-xs">
                      This file has both staged and unstaged changes. Commit includes only the
                      staged changes unless you include unstaged changes.
                    </p>
                  )}
                  <DiffBlock
                    composerActions={composerActions}
                    annotations={annotations.get(file.path)}
                    path={file.path}
                    hunks={file.hunks}
                    isCollapsed={collapsed}
                    onToggleCollapse={() => {
                      onToggleFile(file.path);
                    }}
                    viewMode={viewMode}
                    wrapLines={wrapLines}
                    showHeader={false}
                    scrollElement={parentRef}
                    scrollOffset={item?.start ?? 0}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
