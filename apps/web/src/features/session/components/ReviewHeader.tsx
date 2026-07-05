import { Columns, Rows, ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react';
import { SearchBar } from '@agentctl/ui';
import type { ChangeEvent } from 'react';

export type FileState =
  | 'untracked'
  | 'staged'
  | 'modified'
  | 'deleted'
  | 'committed'
  | 'conflicted';

export interface ReviewFile {
  path: string;
  state: FileState;
  diff: string;
}

export interface ReviewHeaderProps {
  files: ReviewFile[];
  isMerging?: boolean;
  isDiscarding?: boolean;
  onOpenMergeDialog: () => void;
  onOpenDiscardModal: () => void;
  viewMode: 'inline' | 'split';
  onToggleViewMode: () => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onNextDiff?: () => void;
  onPrevDiff?: () => void;
  allCollapsed: boolean;
  onToggleAll: () => void;
}

export function ReviewHeader({
  files,
  isMerging,
  isDiscarding,
  onOpenMergeDialog,
  onOpenDiscardModal,
  viewMode,
  onToggleViewMode,
  searchQuery,
  onSearchChange,
  onNextDiff,
  onPrevDiff,
  allCollapsed,
  onToggleAll,
}: ReviewHeaderProps) {
  return (
    <div className="border-border/10 bg-surface-secondary/10 shrink-0 border-b">
      {/* Row 1: search */}
      <div className="px-4 pt-2.5 pb-2">
        <SearchBar
          value={searchQuery}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            onSearchChange(e.target.value);
          }}
          onClear={() => {
            onSearchChange('');
          }}
          placeholder="Filter files..."
        />
      </div>

      {/* Row 2: action buttons */}
      <div className="flex items-center justify-between px-4 pb-2.5">
        <div className="flex items-center gap-1.5">
          <div className="border-border/10 bg-surface-tertiary/10 flex items-center overflow-hidden rounded-md border">
            <button
              type="button"
              onClick={onPrevDiff}
              className="text-text-muted/40 hover:text-accent hover:bg-surface-tertiary/20 border-border/10 flex h-7 w-6 cursor-pointer items-center justify-center border-r transition-all"
              title="Previous Change"
            >
              <ChevronUp className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onNextDiff}
              className="text-text-muted/40 hover:text-accent hover:bg-surface-tertiary/20 flex h-7 w-6 cursor-pointer items-center justify-center transition-all"
              title="Next Change"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          </div>
          <button
            type="button"
            onClick={onToggleViewMode}
            className="border-border/10 bg-surface-tertiary/20 text-text-muted/40 hover:text-accent hover:border-accent/20 flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border transition-all"
            title={viewMode === 'inline' ? 'Switch to Split View' : 'Switch to Inline View'}
          >
            {viewMode === 'inline' ? (
              <Columns className="h-3.5 w-3.5" />
            ) : (
              <Rows className="h-3.5 w-3.5" />
            )}
          </button>
          {files.length > 0 && (
            <button
              type="button"
              onClick={onToggleAll}
              className="border-border/10 bg-surface-tertiary/20 text-text-muted/40 hover:text-accent hover:border-accent/20 flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border transition-all"
              title={allCollapsed ? 'Expand All' : 'Collapse All'}
            >
              <ChevronsUpDown className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={files.length === 0 || !!isMerging || !!isDiscarding}
            onClick={onOpenDiscardModal}
            className="border-danger/20 bg-danger/5 text-danger hover:bg-danger/10 flex h-7 cursor-pointer items-center rounded-md border px-2.5 text-[9px] font-black tracking-widest uppercase transition-all disabled:cursor-default disabled:opacity-20"
          >
            Discard
          </button>
          <button
            type="button"
            disabled={files.length === 0 || !!isMerging || !!isDiscarding}
            onClick={onOpenMergeDialog}
            className="bg-accent text-brand-crust flex h-7 cursor-pointer items-center rounded-md px-3 text-[9px] font-black tracking-widest uppercase shadow-[0_0_15px_rgba(203,166,247,0.25)] transition-all hover:opacity-90 disabled:cursor-default disabled:opacity-20"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
