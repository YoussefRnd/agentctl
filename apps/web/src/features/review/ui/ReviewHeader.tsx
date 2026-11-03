import { SegmentedControl } from '@agentctl/ui';
import {
  ColumnsIcon,
  RowsIcon,
  UnfoldIcon,
  FoldIcon,
  CheckIcon,
  ChevronDownIcon,
  ListUnorderedIcon,
  WrapIcon,
} from '@primer/octicons-react';

import { Dropdown, SearchBar, Tooltip, cn } from '@agentctl/ui';
import { useMemo, type ChangeEvent, type ReactNode } from 'react';
import type { ReviewScope } from '../model/useReviewUIStore';
import { FileIcon } from '@/shared';

import type { ReviewFile, ReviewFileState as FileState } from '@agentctl/shared';
export type { ReviewFile, ReviewFileState as FileState } from '@agentctl/shared';

export interface ScopeCounts {
  uncommitted: number;
  this_turn: number;
  all_edits: number;
}

const STATE_LETTER: Record<FileState, { letter: string; color: string }> = {
  modified: { letter: 'M', color: 'text-amber-400' },
  untracked: { letter: 'U', color: 'text-emerald-400' },
  staged: { letter: 'S', color: 'text-emerald-400' },
  deleted: { letter: 'D', color: 'text-rose-400' },
  conflicted: { letter: '!', color: 'text-rose-400 animate-pulse' },
  committed: { letter: 'C', color: 'text-text-muted' },
};

export interface ReviewHeaderProps {
  files: ReviewFile[];
  scope: ReviewScope;
  onScopeChange: (scope: ReviewScope) => void;
  scopeCounts: ScopeCounts;
  viewMode: 'inline' | 'split';
  wrapLines: boolean;
  onToggleWrapLines: () => void;
  onToggleViewMode: () => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  allCollapsed: boolean;
  onToggleAll: () => void;
  gitActions?: ReactNode;
  onSelectFile?: (path: string) => void;
  fileStats?: Map<string, { additions: number; deletions: number }>;
  onStageAll?: () => void;
  onUnstageAll?: () => void;
  hasUnstaged?: boolean;
  hasStaged?: boolean;
  isStagingAll?: boolean;
  isUnstagingAll?: boolean;
  statusFilter?: import('../model/useReviewViewState').StatusFilter;
  onStatusFilterChange?: (filter: import('../model/useReviewViewState').StatusFilter) => void;
}

export function ReviewHeader({
  files,
  scope,
  onScopeChange,
  scopeCounts,
  viewMode,
  onToggleViewMode,
  wrapLines,
  onToggleWrapLines,
  searchQuery,
  onSearchChange,
  allCollapsed,
  onToggleAll,
  gitActions,
  onSelectFile,
  fileStats,
  onStageAll,
  onUnstageAll,
  hasUnstaged,
  hasStaged,
  isStagingAll,
  isUnstagingAll,
  statusFilter = 'all',
  onStatusFilterChange,
}: ReviewHeaderProps) {
  const statusCounts = useMemo(() => {
    let modified = 0;
    let untracked = 0;
    let staged = 0;
    let deleted = 0;
    for (const f of files) {
      if (f.state === 'modified') modified++;
      else if (f.state === 'untracked') untracked++;
      else if (f.state === 'staged') staged++;
      else if (f.state === 'deleted') deleted++;
    }
    return {
      all: files.length,
      modified,
      untracked,
      staged,
      deleted,
    };
  }, [files]);

  const scopeOptions: {
    id: ReviewScope;
    label: string;
    count: number;
  }[] = [
    {
      id: 'uncommitted',
      label: 'Working Tree',
      count: scopeCounts.uncommitted,
    },
    {
      id: 'this_turn',
      label: 'Last Turn',
      count: scopeCounts.this_turn,
    },
    {
      id: 'all_edits',
      label: 'Branch Changes',
      count: scopeCounts.all_edits,
    },
  ];

  const currentOption = scopeOptions.find((option) => option.id === scope) ?? scopeOptions[0];

  return (
    <div className="border-border/20 bg-surface-secondary/20 sticky top-0 z-20 shrink-0 space-y-2 border-b p-2 backdrop-blur-md">
      {/* Review scope and display controls */}
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        {/* Scope Dropdown */}
        <Dropdown.Root>
          <Dropdown.Trigger asChild>
            <button
              type="button"
              className="motion-disclosure text-text-main hover:bg-surface/60 border-border/20 data-[state=open]:border-accent/40 data-[state=open]:bg-accent/10 flex h-7 cursor-pointer items-center gap-1.5 rounded-lg border px-2 text-xs font-medium"
            >
              <span>{currentOption.label}</span>
              <ChevronDownIcon className="text-text-muted/50 h-3.5 w-3.5" />
            </button>
          </Dropdown.Trigger>
          <Dropdown.Portal>
            <Dropdown.Content align="start" sideOffset={5} className="min-w-44">
              {scopeOptions.map(({ id, label, count }) => (
                <Dropdown.Item
                  key={id}
                  onSelect={() => {
                    onScopeChange(id);
                  }}
                  className={`flex cursor-pointer items-center justify-between ${
                    scope === id
                      ? 'bg-accent/10 text-accent font-medium'
                      : 'text-text-muted hover:bg-surface/60 hover:text-text-main'
                  }`}
                >
                  <span>{label}</span>
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-[10px] opacity-60">{count}</span>
                    {scope === id && <CheckIcon className="h-3.5 w-3.5" />}
                  </span>
                </Dropdown.Item>
              ))}
            </Dropdown.Content>
          </Dropdown.Portal>
        </Dropdown.Root>

        {/* Navigation and actions */}
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {/* 1. View & Navigation Controls */}
          {/* Jump to File Picker (3 equal lines icon) */}
          {files.length > 0 && onSelectFile && (
            <Dropdown.Root>
              <Tooltip content="Jump to file">
                <Dropdown.Trigger asChild>
                  <button
                    type="button"
                    className="motion-disclosure border-border/20 bg-surface/50 text-text-muted hover:text-text-main hover:bg-surface-secondary data-[state=open]:border-accent/40 data-[state=open]:bg-accent/10 flex h-6.5 cursor-pointer items-center gap-1.5 rounded-md border px-1.5 text-xs"
                    aria-label="Jump to file"
                  >
                    <ListUnorderedIcon className="h-3.5 w-3.5" />
                  </button>
                </Dropdown.Trigger>
              </Tooltip>
              <Dropdown.Portal>
                <Dropdown.Content
                  align="end"
                  sideOffset={5}
                  className="max-h-72 w-64 overflow-y-auto"
                >
                  <div className="text-text-muted/60 px-2 py-1 font-mono text-[9.5px] font-semibold tracking-wider uppercase">
                    Changed Files ({files.length})
                  </div>
                  {files.map((file) => {
                    const fileName = file.path.split('/').pop() ?? file.path;
                    const dirPath = file.path.split('/').slice(0, -1).join('/');
                    const badge = STATE_LETTER[file.state] ?? STATE_LETTER.modified;
                    const stats = fileStats?.get(file.path);

                    return (
                      <Dropdown.Item
                        key={file.path}
                        onSelect={() => onSelectFile(file.path)}
                        className="hover:bg-surface/60 flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs transition-colors"
                      >
                        <div className="flex min-w-0 items-center gap-1.5">
                          <FileIcon path={file.path} className="h-3.5 w-3.5 shrink-0" />
                          <span
                            className={cn(
                              'w-3 shrink-0 text-center font-mono text-[10px] font-bold',
                              badge.color,
                            )}
                          >
                            {badge.letter}
                          </span>
                          <span className="flex min-w-0 flex-col" title={file.path}>
                            <span className="text-text-main truncate font-mono text-xs font-medium">
                              {fileName}
                            </span>
                            {dirPath && (
                              <span className="text-text-muted/50 truncate font-mono text-[10px]">
                                {dirPath}/
                              </span>
                            )}
                          </span>
                        </div>

                        {stats && (stats.additions > 0 || stats.deletions > 0) && (
                          <div className="flex shrink-0 items-center gap-1 font-mono text-[10px] font-semibold tabular-nums">
                            {stats.additions > 0 && (
                              <span className="text-emerald-400">+{stats.additions}</span>
                            )}
                            {stats.deletions > 0 && (
                              <span className="text-rose-400">-{stats.deletions}</span>
                            )}
                          </div>
                        )}
                      </Dropdown.Item>
                    );
                  })}
                </Dropdown.Content>
              </Dropdown.Portal>
            </Dropdown.Root>
          )}

          <Dropdown.Root>
            <Dropdown.Trigger asChild>
              <button
                type="button"
                aria-label="Diff display options"
                className="motion-disclosure border-border/20 bg-surface/50 text-text-muted hover:text-text-main data-[state=open]:bg-accent/10 flex h-7 cursor-pointer items-center gap-1 rounded-md border px-2 text-[11px]"
              >
                <span>View</span>
                <ChevronDownIcon className="h-3 w-3" />
              </button>
            </Dropdown.Trigger>
            <Dropdown.Portal>
              <Dropdown.Content align="end" className="min-w-44">
                {(['inline', 'split'] as const).map((mode) => (
                  <Dropdown.Item
                    key={mode}
                    role="menuitemradio"
                    aria-checked={viewMode === mode}
                    onSelect={() => {
                      if (viewMode !== mode) onToggleViewMode();
                    }}
                    className="gap-2"
                  >
                    {mode === 'inline' ? (
                      <RowsIcon className="h-3.5 w-3.5" />
                    ) : (
                      <ColumnsIcon className="h-3.5 w-3.5" />
                    )}
                    <span className="flex-1">
                      {mode === 'inline' ? 'Inline diff' : 'Split diff'}
                    </span>
                    {viewMode === mode && <CheckIcon className="text-accent h-3.5 w-3.5" />}
                  </Dropdown.Item>
                ))}
                <Dropdown.Separator />
                <Dropdown.Item
                  role="menuitemcheckbox"
                  aria-checked={wrapLines}
                  onSelect={onToggleWrapLines}
                  className="gap-2"
                >
                  <WrapIcon className="h-3.5 w-3.5" />
                  <span className="flex-1">Wrap lines</span>
                  {wrapLines && <CheckIcon className="text-accent h-3.5 w-3.5" />}
                </Dropdown.Item>
                {files.length > 0 && (
                  <>
                    <Dropdown.Separator />
                    <Dropdown.Item onSelect={onToggleAll} className="gap-2">
                      {allCollapsed ? (
                        <UnfoldIcon className="h-3.5 w-3.5" />
                      ) : (
                        <FoldIcon className="h-3.5 w-3.5" />
                      )}
                      {allCollapsed ? 'Expand all diffs' : 'Collapse all diffs'}
                    </Dropdown.Item>
                  </>
                )}
              </Dropdown.Content>
            </Dropdown.Portal>
          </Dropdown.Root>

          {/* 2. Git Actions Suite */}
          {/* Stage All / Unstage All pill */}
          {hasUnstaged && onStageAll && (
            <button
              type="button"
              disabled={isStagingAll}
              onClick={onStageAll}
              className="border-border/25 text-text-muted hover:text-text-main hover:bg-surface-secondary flex h-7 cursor-pointer items-center rounded-md border px-2 text-[11px] transition-colors disabled:opacity-50"
            >
              {isStagingAll ? 'Staging...' : 'Stage all'}
            </button>
          )}

          {!hasUnstaged && hasStaged && onUnstageAll && (
            <button
              type="button"
              disabled={isUnstagingAll}
              onClick={onUnstageAll}
              className="border-border/30 bg-surface text-text-muted hover:text-text-main hover:bg-surface-secondary flex h-6 cursor-pointer items-center rounded-md border px-2 text-[11px] font-semibold transition-colors active:scale-[0.97] disabled:opacity-50"
            >
              {isUnstagingAll ? 'Unstaging...' : 'Unstage all'}
            </button>
          )}
        </div>
      </div>

      {gitActions && <div className="border-border/15 border-t pt-2">{gitActions}</div>}

      {/* Search and file filters */}
      <div className="space-y-1.5">
        <SearchBar
          value={searchQuery}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            onSearchChange(e.target.value);
          }}
          onClear={() => {
            onSearchChange('');
          }}
          placeholder="Filter changed files..."
          className="bg-surface/40 border-border/25 hover:border-border/40 focus:border-accent/40 h-7 text-xs"
        />

        {files.length > 0 && onStatusFilterChange && (
          <SegmentedControl
            aria-label="Filter changed files"
            className="[scrollbar-width:none] flex-nowrap overflow-x-auto"
            typographyClassName="text-[10px] font-medium"
            itemClassName="h-5 gap-1 px-1.5 py-0"
            value={statusFilter}
            onValueChange={(filter) =>
              onStatusFilterChange(filter !== 'all' && filter === statusFilter ? 'all' : filter)
            }
            options={(['all', 'modified', 'untracked', 'staged', 'deleted'] as const)
              .filter((state) => state === 'all' || statusCounts[state] > 0)
              .map((state) => ({
                value: state,
                className: statusFilter === state ? 'font-semibold shrink-0' : 'shrink-0',
                icon:
                  state !== 'all' ? (
                    <span
                      className={cn(
                        'font-mono font-bold',
                        statusFilter === state ? 'text-current' : STATE_LETTER[state].color,
                      )}
                    >
                      {STATE_LETTER[state].letter}
                    </span>
                  ) : undefined,
                label: (
                  <>
                    <span>
                      {
                        {
                          all: 'All',
                          modified: 'Modified',
                          untracked: 'Untracked',
                          staged: 'Staged',
                          deleted: 'Deleted',
                        }[state]
                      }
                    </span>
                    <span className="font-mono tabular-nums opacity-60">{statusCounts[state]}</span>
                  </>
                ),
              }))}
          />
        )}
      </div>
    </div>
  );
}
