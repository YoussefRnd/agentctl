import { Columns, Rows, ChevronsUpDown, ChevronDown, Check } from 'lucide-react';
import { SearchBar, Tooltip, Dropdown } from '@agentctl/ui';
import type { ChangeEvent } from 'react';
import type { ReviewScope } from '@/shared';

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
}: ReviewHeaderProps) {
  const scopeOptions: {
    id: ReviewScope;
    label: string;
    count: number;
  }[] = [
    {
      id: 'uncommitted',
      label: 'Uncommitted',
      count: scopeCounts.uncommitted,
    },
    {
      id: 'this_turn',
      label: 'This turn',
      count: scopeCounts.this_turn,
    },
    {
      id: 'all_edits',
      label: 'All edits',
      count: scopeCounts.all_edits,
    },
  ];

  const currentOption = scopeOptions.find((opt) => opt.id === scope) ?? scopeOptions[0];

  return (
    <div className="border-border/20 bg-surface-secondary/20 sticky top-0 z-20 shrink-0 space-y-2 border-b p-2.5 backdrop-blur-md">
      {/* Top Toolbar Row: Scope Selector (Left) + View Mode & Collapse (Right) */}
      <div className="flex items-center justify-between gap-2">
        {/* Scope Dropdown */}
        <Dropdown.Root>
          <Dropdown.Trigger asChild>
            <button
              type="button"
              className="border-border/30 bg-surface/50 hover:bg-surface/80 hover:border-border/50 text-text-main focus:border-accent/40 flex h-7 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors select-none focus:outline-none"
            >
              <span>{currentOption.label}</span>
              <span className="bg-surface-tertiary/40 text-text-muted py-0.2 rounded px-1.5 font-mono text-[10px] font-semibold tabular-nums">
                {currentOption.count}
              </span>
              <ChevronDown className="text-text-muted/60 ml-0.5 h-3 w-3 transition-transform" />
            </button>
          </Dropdown.Trigger>
          <Dropdown.Portal>
            <Dropdown.Content
              align="start"
              sideOffset={4}
              className="border-border/30 bg-brand-mantle/95 z-50 min-w-44 rounded-xl border p-1 shadow-2xl backdrop-blur-md"
            >
              {scopeOptions.map(({ id, label, count }) => {
                const isSelected = scope === id;
                return (
                  <Dropdown.Item
                    key={id}
                    onClick={() => {
                      onScopeChange(id);
                    }}
                    className={`flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs transition-colors ${
                      isSelected
                        ? 'bg-accent/15 text-accent font-semibold'
                        : 'text-text-muted hover:text-text-main hover:bg-surface/60'
                    }`}
                  >
                    <span>{label}</span>
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[10.5px] tabular-nums opacity-70">
                        {count}
                      </span>
                      {isSelected && <Check className="text-accent h-3 w-3" />}
                    </div>
                  </Dropdown.Item>
                );
              })}
            </Dropdown.Content>
          </Dropdown.Portal>
        </Dropdown.Root>

        {/* View Mode (Inline / Split) + Collapse Controls */}
        <div className="flex shrink-0 items-center gap-1.5">
          <div className="border-border/15 bg-surface-tertiary/15 flex items-center overflow-hidden rounded-md border p-0.5 text-xs">
            <button
              type="button"
              onClick={() => {
                if (viewMode !== 'inline') onToggleViewMode();
              }}
              className={`flex h-6 cursor-pointer items-center gap-1 rounded px-2 text-[11px] font-medium transition-colors ${
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
              className={`flex h-6 cursor-pointer items-center gap-1 rounded px-2 text-[11px] font-medium transition-colors ${
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

          {files.length > 0 && (
            <Tooltip content={allCollapsed ? 'Expand all diffs' : 'Collapse all diffs'}>
              <button
                type="button"
                onClick={onToggleAll}
                className="border-border/15 bg-surface-tertiary/15 text-text-muted/60 hover:text-accent hover:border-accent/20 flex h-6.5 w-6.5 cursor-pointer items-center justify-center rounded-md border transition-colors"
                aria-label={allCollapsed ? 'Expand all diffs' : 'Collapse all diffs'}
              >
                <ChevronsUpDown className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Bottom Row: Full-width Search / Filter Input */}
      <div className="w-full">
        <SearchBar
          value={searchQuery}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            onSearchChange(e.target.value);
          }}
          onClear={() => {
            onSearchChange('');
          }}
          placeholder="Filter changed files..."
          className="bg-surface/30 border-border/25 hover:border-border/40 focus:border-accent/40 h-7.5 text-xs"
        />
      </div>
    </div>
  );
}
