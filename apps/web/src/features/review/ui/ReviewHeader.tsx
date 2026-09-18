import {
  Columns,
  Rows,
  ChevronsUpDown,
  ChevronsDownUp,
  Check,
  ChevronDown,
  Menu,
} from 'lucide-react';
import { Dropdown, SearchBar, Tooltip, cn } from '@agentctl/ui';
import { useMemo, type ChangeEvent, type ReactNode } from 'react';
import type { ReviewScope } from '../model/useReviewUIStore';
import { FileIcon } from '@/shared';

export type FileState =
  'untracked' | 'staged' | 'modified' | 'deleted' | 'committed' | 'conflicted';

export interface ReviewFile {
  path: string;
  state: FileState;
  diff: string;
}

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
      {/* Top Toolbar Row: Scope Selector (Left) + Jump to file + View Mode + Stage All + Collapse (Right) */}
      <div className="flex items-center justify-between gap-1.5">
        {/* Scope Dropdown */}
        <Dropdown.Root>
          <Dropdown.Trigger asChild>
            <button
              type="button"
              className="motion-disclosure text-text-main hover:bg-surface/60 border-border/20 data-[state=open]:border-accent/40 data-[state=open]:bg-accent/10 flex h-7 cursor-pointer items-center gap-1.5 rounded-lg border px-2 text-xs font-medium"
            >
              <span>{currentOption.label}</span>
              <span className="text-text-muted/60 font-mono text-[10px] tabular-nums">
                {currentOption.count}
              </span>
              <ChevronDown className="text-text-muted/50 h-3.5 w-3.5" />
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
                    {scope === id && <Check className="h-3.5 w-3.5" />}
                  </span>
                </Dropdown.Item>
              ))}
            </Dropdown.Content>
          </Dropdown.Portal>
        </Dropdown.Root>

        {/* Right Action Suite: Option A (View Controls -> Divider -> Git Actions) */}
        <div className="flex shrink-0 items-center gap-1.5">
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
                    <Menu className="h-3.5 w-3.5" />
                    <span className="font-mono text-[10px] tabular-nums">{files.length}</span>
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
                          <span className="text-text-main truncate font-mono text-xs font-medium">
                            {fileName}
                          </span>
                          {dirPath && (
                            <span className="text-text-muted/40 truncate font-mono text-[10px]">
                              {dirPath}/
                            </span>
                          )}
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

          {/* Expand / Collapse All */}
          {files.length > 0 && (
            <Tooltip content={allCollapsed ? 'Expand all diffs' : 'Collapse all diffs'}>
              <button
                type="button"
                onClick={onToggleAll}
                className="border-border/20 bg-surface/50 text-text-muted/70 hover:text-text-main hover:bg-surface-secondary flex h-6.5 w-6.5 cursor-pointer items-center justify-center rounded-md border transition-colors active:scale-[0.95]"
                aria-label={allCollapsed ? 'Expand all diffs' : 'Collapse all diffs'}
              >
                {allCollapsed ? (
                  <ChevronsUpDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronsDownUp className="h-3.5 w-3.5" />
                )}
              </button>
            </Tooltip>
          )}

          {/* Compact View Mode (Inline / Split) */}
          <div className="border-border/20 bg-surface/50 flex items-center overflow-hidden rounded-md border p-0.5">
            <Tooltip content="Inline diff view">
              <button
                type="button"
                onClick={() => {
                  if (viewMode !== 'inline') onToggleViewMode();
                }}
                className={`flex h-5.5 w-5.5 cursor-pointer items-center justify-center rounded transition-colors ${
                  viewMode === 'inline'
                    ? 'bg-surface-accent text-accent shadow-xs'
                    : 'text-text-muted/60 hover:text-text-main'
                }`}
                aria-label="Inline diff view"
              >
                <Rows className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
            <Tooltip content="Split side-by-side view">
              <button
                type="button"
                onClick={() => {
                  if (viewMode !== 'split') onToggleViewMode();
                }}
                className={`flex h-5.5 w-5.5 cursor-pointer items-center justify-center rounded transition-colors ${
                  viewMode === 'split'
                    ? 'bg-surface-accent text-accent shadow-xs'
                    : 'text-text-muted/60 hover:text-text-main'
                }`}
                aria-label="Split side-by-side view"
              >
                <Columns className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
          </div>

          {/* Subtle Vertical Divider */}
          <div className="bg-border/25 mx-0.5 h-3.5 w-px" />

          {/* 2. Git Actions Suite */}
          {/* Stage All / Unstage All pill */}
          {hasUnstaged && onStageAll && (
            <button
              type="button"
              disabled={isStagingAll}
              onClick={onStageAll}
              className="border-accent/30 bg-accent/10 text-accent hover:bg-accent/20 flex h-6 cursor-pointer items-center rounded-md border px-2 text-[11px] font-semibold transition-colors active:scale-[0.97] disabled:opacity-50"
            >
              {isStagingAll ? 'Staging...' : 'Stage All'}
            </button>
          )}

          {!hasUnstaged && hasStaged && onUnstageAll && (
            <button
              type="button"
              disabled={isUnstagingAll}
              onClick={onUnstageAll}
              className="border-border/30 bg-surface text-text-muted hover:text-text-main hover:bg-surface-secondary flex h-6 cursor-pointer items-center rounded-md border px-2 text-[11px] font-semibold transition-colors active:scale-[0.97] disabled:opacity-50"
            >
              {isUnstagingAll ? 'Unstaging...' : 'Unstage All'}
            </button>
          )}

          {/* Git Actions dropdown (Commit, PR, Push, etc. - preserved!) */}
          {gitActions}
        </div>
      </div>

      {/* Bottom Row: Full-width Search / Filter Input + Status Filter Chips */}
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
          <div className="flex [scrollbar-width:none] items-center gap-1 overflow-x-auto">
            <button
              type="button"
              onClick={() => onStatusFilterChange('all')}
              className={cn(
                'flex h-5 cursor-pointer items-center gap-1 rounded-md px-1.5 text-[10px] font-medium transition-colors active:scale-[0.96]',
                statusFilter === 'all'
                  ? 'bg-accent/15 text-accent border-accent/30 border font-semibold shadow-xs'
                  : 'text-text-muted/70 hover:text-text-main hover:bg-surface-secondary border border-transparent',
              )}
            >
              <span>All</span>
              <span className="font-mono tabular-nums opacity-60">{statusCounts.all}</span>
            </button>

            {statusCounts.modified > 0 && (
              <button
                type="button"
                onClick={() =>
                  onStatusFilterChange(statusFilter === 'modified' ? 'all' : 'modified')
                }
                className={cn(
                  'flex h-5 cursor-pointer items-center gap-1 rounded-md px-1.5 text-[10px] font-medium transition-colors active:scale-[0.96]',
                  statusFilter === 'modified'
                    ? 'border border-amber-500/30 bg-amber-500/15 font-semibold text-amber-300 shadow-xs'
                    : 'text-text-muted/70 hover:text-text-main hover:bg-surface-secondary border border-transparent',
                )}
              >
                <span className="font-mono font-bold text-amber-400">M</span>
                <span>Modified</span>
                <span className="font-mono tabular-nums opacity-60">{statusCounts.modified}</span>
              </button>
            )}

            {statusCounts.untracked > 0 && (
              <button
                type="button"
                onClick={() =>
                  onStatusFilterChange(statusFilter === 'untracked' ? 'all' : 'untracked')
                }
                className={cn(
                  'flex h-5 cursor-pointer items-center gap-1 rounded-md px-1.5 text-[10px] font-medium transition-colors active:scale-[0.96]',
                  statusFilter === 'untracked'
                    ? 'border border-emerald-500/30 bg-emerald-500/15 font-semibold text-emerald-300 shadow-xs'
                    : 'text-text-muted/70 hover:text-text-main hover:bg-surface-secondary border border-transparent',
                )}
              >
                <span className="font-mono font-bold text-emerald-400">U</span>
                <span>Untracked</span>
                <span className="font-mono tabular-nums opacity-60">{statusCounts.untracked}</span>
              </button>
            )}

            {statusCounts.staged > 0 && (
              <button
                type="button"
                onClick={() => onStatusFilterChange(statusFilter === 'staged' ? 'all' : 'staged')}
                className={cn(
                  'flex h-5 cursor-pointer items-center gap-1 rounded-md px-1.5 text-[10px] font-medium transition-colors active:scale-[0.96]',
                  statusFilter === 'staged'
                    ? 'border border-emerald-500/30 bg-emerald-500/15 font-semibold text-emerald-300 shadow-xs'
                    : 'text-text-muted/70 hover:text-text-main hover:bg-surface-secondary border border-transparent',
                )}
              >
                <span className="font-mono font-bold text-emerald-400">S</span>
                <span>Staged</span>
                <span className="font-mono tabular-nums opacity-60">{statusCounts.staged}</span>
              </button>
            )}

            {statusCounts.deleted > 0 && (
              <button
                type="button"
                onClick={() => onStatusFilterChange(statusFilter === 'deleted' ? 'all' : 'deleted')}
                className={cn(
                  'flex h-5 cursor-pointer items-center gap-1 rounded-md px-1.5 text-[10px] font-medium transition-colors active:scale-[0.96]',
                  statusFilter === 'deleted'
                    ? 'border border-rose-500/30 bg-rose-500/15 font-semibold text-rose-300 shadow-xs'
                    : 'text-text-muted/70 hover:text-text-main hover:bg-surface-secondary border border-transparent',
                )}
              >
                <span className="font-mono font-bold text-rose-400">D</span>
                <span>Deleted</span>
                <span className="font-mono tabular-nums opacity-60">{statusCounts.deleted}</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
