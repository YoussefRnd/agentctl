import { useMemo } from 'react';
import { DiffBlock } from './diff/DiffBlock';
import type { ReviewFile, FileState } from './ReviewHeader';
import {
  ChevronRight,
  ChevronDown,
  ExternalLink,
  Plus,
  Minus,
  Undo2,
  MessageSquarePlus,
  Ellipsis,
} from 'lucide-react';
import { Dropdown, cn } from '@agentctl/ui';
import { toast } from 'sonner';
import type { parseDiff } from '@/shared/lib/diff-parser';
import { FileIcon } from '@/shared';
import { useDraftStore } from '@/features/composer';

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
  files?: (ReviewFile & { hunks: ReturnType<typeof parseDiff> })[];
  groupedFiles?: Record<FileState, (ReviewFile & { hunks: ReturnType<typeof parseDiff> })[]>;
  collapsedSections?: Record<string, boolean>;
  collapsedFiles: Record<string, boolean>;
  fileStats: Map<string, { additions: number; deletions: number }>;
  viewMode: 'inline' | 'split';
  wrapLines?: boolean;
  onToggleSection?: (state: FileState) => void;
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
  files,
  groupedFiles,
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
}: ReviewFileListProps) {
  // Support both unified files array and legacy groupedFiles
  const allFiles = useMemo(() => {
    if (files) return files;
    if (groupedFiles) {
      return Object.values(groupedFiles).flat();
    }
    return [];
  }, [files, groupedFiles]);

  if (allFiles.length === 0) return null;

  return (
    <div className="custom-scrollbar flex-1 overflow-y-auto">
      {allFiles.map((file) => {
        const collapsed = collapsedFiles[file.path] ?? true;
        const stats = fileStats.get(file.path) ?? { additions: 0, deletions: 0 };
        const fileName = file.path.split('/').pop() ?? file.path;
        const dirPath = file.path.split('/').slice(0, -1).join('/');
        const canStage = Boolean(
          onStage && (file.hasUnstagedChanges ?? !['staged', 'committed'].includes(file.state)),
        );
        const canUnstage = Boolean(onUnstage && (file.hasStagedChanges ?? file.state === 'staged'));
        const badge = STATE_BADGE[file.state] ?? STATE_BADGE.modified;

        return (
          <div
            key={`${file.state}:${file.path}`}
            ref={file.path === targetFilePath ? targetFileRef : undefined}
            className="border-border/10 border-b"
          >
            {/* Sticky File Header: docks to top while scrolling through diff */}
            <div
              className={cn(
                'group/filerow border-border/20 bg-surface/95 sticky top-0 z-10 flex w-full items-center justify-between border-b backdrop-blur-md transition-colors',
                !collapsed
                  ? 'border-l-accent/80 bg-surface-secondary/40 border-l-2 shadow-xs'
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
                      <ChevronRight className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
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
                    {canStage ? <Plus className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
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
                      <Ellipsis className="h-3.5 w-3.5" />
                    </button>
                  </Dropdown.Trigger>
                  <Dropdown.Portal>
                    <Dropdown.Content align="end" className="min-w-44">
                      {onOpenFile && (
                        <Dropdown.Item onSelect={() => onOpenFile(file.path)} className="gap-2">
                          <ExternalLink className="h-3.5 w-3.5" />
                          Open in editor
                        </Dropdown.Item>
                      )}
                      <Dropdown.Item
                        className="gap-2"
                        onSelect={() => {
                          useDraftStore.getState().attachContextToComposer({
                            id: `file:${file.path}`,
                            type: 'file',
                            title: fileName,
                            subtitle: file.path,
                            value: file.path,
                          });
                          toast.success(`Added @${fileName} to chat`);
                        }}
                      >
                        <MessageSquarePlus className="h-3.5 w-3.5" />
                        Add to chat
                      </Dropdown.Item>
                      {canStage && canUnstage && (
                        <Dropdown.Item onSelect={() => onUnstage?.(file.path)} className="gap-2">
                          <Minus className="h-3.5 w-3.5" />
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
                            <Undo2 className="h-3.5 w-3.5" />
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
                    This file has both staged and unstaged changes. Commit includes only the staged
                    changes unless you include unstaged changes.
                  </p>
                )}
                <DiffBlock
                  path={file.path}
                  hunks={file.hunks}
                  isCollapsed={collapsed}
                  onToggleCollapse={() => {
                    onToggleFile(file.path);
                  }}
                  viewMode={viewMode}
                  wrapLines={wrapLines}
                  showHeader={false}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
