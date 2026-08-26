import { Columns, Rows, ChevronsUpDown } from 'lucide-react';
import { SearchBar, Tooltip } from '@agentctl/ui';
import type { ChangeEvent } from 'react';

export type FileState =
  'untracked' | 'staged' | 'modified' | 'deleted' | 'committed' | 'conflicted';

export interface ReviewFile {
  path: string;
  state: FileState;
  diff: string;
}

export interface ReviewHeaderProps {
  files: ReviewFile[];
  viewMode: 'inline' | 'split';
  onToggleViewMode: () => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  allCollapsed: boolean;
  onToggleAll: () => void;
}

export function ReviewHeader({
  files,
  viewMode,
  onToggleViewMode,
  searchQuery,
  onSearchChange,
  allCollapsed,
  onToggleAll,
}: ReviewHeaderProps) {
  return (
    <div className="border-border/10 bg-surface-secondary/15 sticky top-0 z-20 shrink-0 border-b backdrop-blur-md">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        {/* Search / Filter input */}
        <div className="min-w-0 flex-1">
          <SearchBar
            value={searchQuery}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              onSearchChange(e.target.value);
            }}
            onClear={() => {
              onSearchChange('');
            }}
            placeholder="Filter changed files..."
            className="bg-surface-secondary/30 border-border/20 hover:border-border/40 focus:border-accent/40 h-7 text-xs"
          />
        </div>

        {/* View Controls Group */}
        <div className="flex shrink-0 items-center gap-1.5">
          {/* View mode toggle: Inline Diff vs Split Diff */}
          <div className="border-border/15 bg-surface-tertiary/15 flex items-center overflow-hidden rounded-md border p-0.5 text-xs">
            <button
              type="button"
              onClick={() => {
                if (viewMode !== 'inline') onToggleViewMode();
              }}
              className={`flex h-6 items-center gap-1 rounded px-2 text-[11px] font-medium transition-colors ${
                viewMode === 'inline'
                  ? 'bg-surface-accent text-accent shadow-xs'
                  : 'text-text-muted/60 hover:text-text-muted'
              }`}
              title="Inline diff view"
            >
              <Rows className="h-3 w-3" />
              <span>Inline</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (viewMode !== 'split') onToggleViewMode();
              }}
              className={`flex h-6 items-center gap-1 rounded px-2 text-[11px] font-medium transition-colors ${
                viewMode === 'split'
                  ? 'bg-surface-accent text-accent shadow-xs'
                  : 'text-text-muted/60 hover:text-text-muted'
              }`}
              title="Side-by-side split diff view"
            >
              <Columns className="h-3 w-3" />
              <span>Split</span>
            </button>
          </div>

          {/* Expand / Collapse All */}
          {files.length > 0 && (
            <Tooltip content={allCollapsed ? 'Expand all diffs' : 'Collapse all diffs'}>
              <button
                type="button"
                onClick={onToggleAll}
                className="border-border/15 bg-surface-tertiary/15 text-text-muted/60 hover:text-accent hover:border-accent/20 flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border transition-colors"
                aria-label={allCollapsed ? 'Expand all diffs' : 'Collapse all diffs'}
              >
                <ChevronsUpDown className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  );
}
