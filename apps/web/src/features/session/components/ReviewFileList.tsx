import { Fragment } from 'react';
import { DiffBlock } from './diff/DiffBlock';
import type { ReviewFile, FileState } from './ReviewHeader';
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
import type { parseDiff } from '../../../utils/diff-parser';

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
  onStageAll?: () => void;
  onUnstageAll?: () => void;
  isStagingAll?: boolean;
  isUnstagingAll?: boolean;
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
  onStageAll,
  onUnstageAll,
  isStagingAll,
  isUnstagingAll,
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
                const FileStateIcon = stateIcons[file.state];
                const stats = fileStats.get(file.path) ?? { additions: 0, deletions: 0 };
                const fileName = file.path.split('/').pop() ?? file.path;
                const dirPath = file.path.split('/').slice(0, -1).join('/');

                return (
                  <div key={`${fileState}:${file.path}`} id={`diff-block-${file.path}`}>
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
                          onToggleFile(file.path);
                        }}
                        aria-expanded={!collapsed}
                        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 border-0 bg-transparent p-0 text-left"
                      >
                        <FileStateIcon
                          className={`h-3.5 w-3.5 shrink-0 ${stateColorMini[file.state]}`}
                        />
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="text-text-main/80 truncate font-mono text-xs font-medium">
                            {fileName}
                          </span>
                          {dirPath && (
                            <span className="text-text-muted/40 truncate font-mono text-[10px]">
                              {dirPath}/
                            </span>
                          )}
                        </div>
                      </button>

                      <div className="flex shrink-0 items-center gap-1.5 font-mono text-[10px] font-semibold">
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
                          className="bg-accent/15 text-accent/90 hover:bg-accent/25 h-6 shrink-0 cursor-pointer rounded px-2 text-xs font-medium transition-colors"
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
                          className="bg-accent/15 text-accent/90 hover:bg-accent/25 h-6 shrink-0 cursor-pointer rounded px-2 text-xs font-medium transition-colors"
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
                            className="bg-danger/10 text-danger/80 hover:bg-danger/20 h-6 shrink-0 cursor-pointer rounded px-2 text-xs font-medium transition-colors"
                          >
                            Revert
                          </button>
                        )}

                      <button
                        type="button"
                        onClick={() => {
                          onToggleFile(file.path);
                        }}
                        aria-expanded={!collapsed}
                        className="text-text-muted/20 hover:text-text-muted/50 cursor-pointer border-0 bg-transparent p-0 transition-colors"
                      >
                        {collapsed ? (
                          <ChevronRight className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" />
                        )}
                      </button>
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
