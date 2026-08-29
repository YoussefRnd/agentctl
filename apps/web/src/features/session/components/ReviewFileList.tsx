import { Fragment } from 'react';
import { DiffBlock } from './diff/DiffBlock';
import type { ReviewFile, FileState } from './ReviewHeader';
import { ChevronRight, ChevronDown, ExternalLink, Plus, Minus, RotateCcw } from 'lucide-react';
import { Tooltip } from '@agentctl/ui';
import type { parseDiff } from '../../../shared/lib/diff-parser';
import { FileIcon } from '@/shared';

const stateSectionColor: Record<FileState, string> = {
  modified: 'bg-warning',
  deleted: 'bg-danger',
  staged: 'bg-success',
  conflicted: 'bg-danger animate-pulse',
  untracked: 'bg-accent',
  committed: 'bg-accent',
};

interface ReviewFileListProps {
  groupedFiles: Record<FileState, (ReviewFile & { hunks: ReturnType<typeof parseDiff> })[]>;
  collapsedSections: Record<string, boolean>;
  collapsedFiles: Record<string, boolean>;
  fileStats: Map<string, { additions: number; deletions: number }>;
  viewMode: 'inline' | 'split';
  onToggleSection: (state: FileState) => void;
  onToggleFile: (path: string) => void;
  onStage?: (path: string) => void;
  onUnstage?: (path: string) => void;
  onRevert?: (path: string) => void;
  onOpenFile?: (path: string) => void;
  onStageAll?: () => void;
  onUnstageAll?: () => void;
  isStagingAll?: boolean;
  isUnstagingAll?: boolean;
  targetFilePath?: string | null;
  targetFileRef?: (element: HTMLDivElement | null) => void;
}

export function ReviewFileList({
  groupedFiles,
  collapsedSections,
  collapsedFiles,
  fileStats,
  viewMode,
  onToggleSection,
  onToggleFile,
  onStage,
  onUnstage,
  onRevert,
  onOpenFile,
  onStageAll,
  onUnstageAll,
  isStagingAll,
  isUnstagingAll,
  targetFilePath,
  targetFileRef,
}: ReviewFileListProps) {
  const fileStateKeys = Object.keys(groupedFiles) as FileState[];

  return (
    <div className="custom-scrollbar flex-1 overflow-y-auto">
      {fileStateKeys.map((fileState) => {
        const entries = groupedFiles[fileState];
        if (entries.length === 0) return null;
        const isSectionCollapsed = collapsedSections[fileState];

        return (
          <Fragment key={fileState}>
            <div className="border-border/10 bg-surface-secondary/20 sticky top-0 z-10 flex w-full items-center justify-between border-y px-4 py-1.5 backdrop-blur-md">
              <button
                type="button"
                onClick={() => {
                  onToggleSection(fileState);
                }}
                aria-expanded={!isSectionCollapsed}
                className="flex cursor-pointer items-center gap-3 transition-opacity hover:opacity-80"
              >
                <div
                  className={`h-1.5 w-1.5 rounded-full ${stateSectionColor[fileState]} opacity-60 shadow-[0_0_8px_currentColor]`}
                />
                <span className="text-text-muted/60 text-xs font-semibold capitalize">
                  {fileState}
                </span>
                <span className="text-text-muted/40 text-[10px] font-semibold tabular-nums">
                  {entries.length}
                </span>
                <div className="text-text-muted/40">
                  {isSectionCollapsed ? (
                    <ChevronRight className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" />
                  )}
                </div>
              </button>

              {fileState === 'staged' && onUnstageAll && (
                <button
                  type="button"
                  disabled={isUnstagingAll}
                  onClick={(e) => {
                    e.stopPropagation();
                    onUnstageAll();
                  }}
                  className="text-accent hover:text-accent/80 cursor-pointer text-xs font-medium transition-colors disabled:opacity-40"
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
                  className="text-accent hover:text-accent/80 cursor-pointer text-xs font-medium transition-colors disabled:opacity-40"
                >
                  {isStagingAll ? 'Staging...' : 'Stage All'}
                </button>
              )}
            </div>

            {!isSectionCollapsed &&
              entries.map((file) => {
                const collapsed = collapsedFiles[file.path] ?? true;
                const stats = fileStats.get(file.path) ?? { additions: 0, deletions: 0 };
                const fileName = file.path.split('/').pop() ?? file.path;
                const dirPath = file.path.split('/').slice(0, -1).join('/');

                return (
                  <div
                    key={`${fileState}:${file.path}`}
                    ref={file.path === targetFilePath ? targetFileRef : undefined}
                  >
                    <div
                      className={`group/filerow border-border/5 flex w-full items-center border-b transition-colors ${
                        !collapsed
                          ? 'bg-surface-secondary/15 border-l-accent border-l-2'
                          : 'hover:bg-surface-secondary/15'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          onToggleFile(file.path);
                        }}
                        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 px-3.5 py-1.5 text-left select-none"
                      >
                        <span className="text-text-muted/40 group-hover/filerow:text-text-muted shrink-0 transition-colors">
                          {collapsed ? (
                            <ChevronRight className="h-3 w-3" />
                          ) : (
                            <ChevronDown className="h-3 w-3" />
                          )}
                        </span>

                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <FileIcon path={file.path} className="h-3.5 w-3.5 shrink-0" />
                          <span className="text-text-main/90 truncate font-mono text-xs font-medium">
                            {fileName}
                          </span>
                          {dirPath && (
                            <span className="text-text-muted/40 truncate font-mono text-[10px]">
                              {dirPath}/
                            </span>
                          )}
                        </div>

                        <div className="flex shrink-0 items-center gap-1 font-mono text-[10.5px] font-semibold tabular-nums">
                          {stats.additions > 0 && (
                            <span className="text-success/90">+{stats.additions}</span>
                          )}
                          {stats.deletions > 0 && (
                            <span className="text-danger/90">-{stats.deletions}</span>
                          )}
                        </div>
                      </button>

                      <div className="mr-3.5 flex shrink-0 items-center gap-0.5">
                        {onOpenFile && (
                          <Tooltip content="Open file in editor">
                            <button
                              type="button"
                              onClick={() => {
                                onOpenFile(file.path);
                              }}
                              className="text-text-muted/50 hover:text-text-main hover:bg-surface-tertiary/40 flex h-6 w-6 cursor-pointer items-center justify-center rounded transition-colors"
                              aria-label="Open file in editor"
                            >
                              <ExternalLink className="h-3 w-3" />
                            </button>
                          </Tooltip>
                        )}

                        {onRevert &&
                          (file.state === 'modified' ||
                            file.state === 'deleted' ||
                            file.state === 'staged') && (
                            <Tooltip content="Discard changes">
                              <button
                                type="button"
                                onClick={() => {
                                  onRevert(file.path);
                                }}
                                className="text-text-muted/50 hover:text-danger hover:bg-danger/10 flex h-6 w-6 cursor-pointer items-center justify-center rounded transition-colors"
                                aria-label="Discard changes"
                              >
                                <RotateCcw className="h-3 w-3" />
                              </button>
                            </Tooltip>
                          )}

                        {onStage && (file.state === 'modified' || file.state === 'untracked') && (
                          <Tooltip content="Stage changes">
                            <button
                              type="button"
                              onClick={() => {
                                onStage(file.path);
                              }}
                              className="text-text-muted/60 hover:text-accent hover:bg-accent/15 flex h-6 w-6 cursor-pointer items-center justify-center rounded transition-colors"
                              aria-label="Stage changes"
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                          </Tooltip>
                        )}

                        {onUnstage && file.state === 'staged' && (
                          <Tooltip content="Unstage changes">
                            <button
                              type="button"
                              onClick={() => {
                                onUnstage(file.path);
                              }}
                              className="text-text-muted/60 hover:text-text-main hover:bg-surface-tertiary/40 flex h-6 w-6 cursor-pointer items-center justify-center rounded transition-colors"
                              aria-label="Unstage changes"
                            >
                              <Minus className="h-3.5 w-3.5" />
                            </button>
                          </Tooltip>
                        )}
                      </div>
                    </div>

                    {!collapsed && (
                      <div className="border-border/5 bg-surface-secondary/5 border-b">
                        <DiffBlock
                          path={file.path}
                          hunks={file.hunks}
                          isCollapsed={false}
                          viewMode={viewMode}
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
                          onOpenFile={
                            onOpenFile
                              ? () => {
                                  onOpenFile(file.path);
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
  );
}
