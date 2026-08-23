import { Columns, Rows, ChevronDown, ChevronUp, ChevronsUpDown, FileCode } from 'lucide-react';
import { SearchBar } from '@agentctl/ui';
import { useState, type ChangeEvent } from 'react';

export type FileState =
  'untracked' | 'staged' | 'modified' | 'deleted' | 'committed' | 'conflicted';

export interface ReviewFile {
  path: string;
  state: FileState;
  diff: string;
}

const stateColorMini: Record<FileState, string> = {
  untracked: 'text-success/80',
  staged: 'text-accent/80',
  modified: 'text-warning/80',
  deleted: 'text-danger/80',
  committed: 'text-text-muted/40',
  conflicted: 'text-danger font-bold',
};

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
  onSelectFile?: (path: string) => void;
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
  onSelectFile,
}: ReviewHeaderProps) {
  const [isIndexOpen, setIsIndexOpen] = useState(false);

  return (
    <div className="border-border/10 bg-surface-secondary/10 sticky top-0 z-20 shrink-0 border-b backdrop-blur-md">
      {/* Row 1: search & file index dropdown */}
      <div className="flex items-center gap-2 px-4 pt-2.5 pb-2">
        <div className="flex-1">
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

        {/* Sticky File Index Navigation Header/Menu */}
        {files.length > 0 && (
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setIsIndexOpen((prev) => !prev);
              }}
              className="border-border/15 bg-surface-tertiary/20 text-text-main hover:text-accent hover:border-accent/30 flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors"
              title="Jump to changed file"
            >
              <FileCode className="text-text-muted h-3.5 w-3.5" />
              <span className="max-w-[130px] truncate">Files ({files.length})</span>
              <ChevronDown className="text-text-muted/60 h-3 w-3" />
            </button>

            {isIndexOpen && (
              <>
                <button
                  type="button"
                  aria-label="Close changed files menu"
                  className="fixed inset-0 z-20 cursor-default bg-transparent"
                  onClick={() => {
                    setIsIndexOpen(false);
                  }}
                />
                <div className="border-border/20 bg-surface/95 absolute right-0 z-30 mt-1 max-h-64 w-72 overflow-y-auto rounded-md border p-1 shadow-xl backdrop-blur-md">
                  <div className="text-text-muted/60 px-2 py-1 text-[11px] font-semibold">
                    Changed files ({files.length})
                  </div>
                  {files.map((file) => {
                    const fileName = file.path.split('/').pop() ?? file.path;
                    const dirPath = file.path.split('/').slice(0, -1).join('/');
                    return (
                      <button
                        key={file.path}
                        type="button"
                        onClick={() => {
                          onSelectFile?.(file.path);
                          setIsIndexOpen(false);
                        }}
                        className="hover:bg-surface-tertiary/30 hover:text-accent flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors"
                      >
                        <span
                          className={`text-[10px] font-bold uppercase ${stateColorMini[file.state]}`}
                        >
                          {file.state[0]}
                        </span>
                        <div className="min-w-0 flex-1 truncate font-mono text-xs">
                          <span className="text-text-main font-medium">{fileName}</span>
                          {dirPath && (
                            <span className="text-text-muted/40 ml-1 text-[10px]">{dirPath}/</span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Row 2: view mode toggle & actions */}
      <div className="flex items-center justify-between px-4 pb-2.5">
        <div className="flex items-center gap-2">
          {/* Previous / Next diff */}
          <div className="border-border/10 bg-surface-tertiary/10 flex items-center overflow-hidden rounded-md border">
            <button
              type="button"
              onClick={onPrevDiff}
              className="text-text-muted/60 hover:text-accent hover:bg-surface-tertiary/20 border-border/10 flex h-7 w-7 cursor-pointer items-center justify-center border-r transition-colors"
              title="Previous change"
            >
              <ChevronUp className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onNextDiff}
              className="text-text-muted/60 hover:text-accent hover:bg-surface-tertiary/20 flex h-7 w-7 cursor-pointer items-center justify-center transition-colors"
              title="Next change"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* View mode toggle: Inline Diff vs Side-by-Side (Split) Diff */}
          <div className="border-border/10 bg-surface-tertiary/10 flex items-center overflow-hidden rounded-md border p-0.5 text-xs">
            <button
              type="button"
              onClick={() => {
                if (viewMode !== 'inline') onToggleViewMode();
              }}
              className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                viewMode === 'inline'
                  ? 'bg-surface-accent text-accent shadow-xs'
                  : 'text-text-muted/60 hover:text-text-muted'
              }`}
              title="Inline diff view"
            >
              <Rows className="h-3.5 w-3.5" />
              <span>Inline</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (viewMode !== 'split') onToggleViewMode();
              }}
              className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                viewMode === 'split'
                  ? 'bg-surface-accent text-accent shadow-xs'
                  : 'text-text-muted/60 hover:text-text-muted'
              }`}
              title="Side-by-side split diff view"
            >
              <Columns className="h-3.5 w-3.5" />
              <span>Split</span>
            </button>
          </div>

          {/* Expand / Collapse All */}
          {files.length > 0 && (
            <button
              type="button"
              onClick={onToggleAll}
              className="border-border/10 bg-surface-tertiary/20 text-text-muted/60 hover:text-accent hover:border-accent/20 flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border transition-colors"
              title={allCollapsed ? 'Expand all' : 'Collapse all'}
            >
              <ChevronsUpDown className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Header Action Buttons in sentence case */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={files.length === 0 || !!isMerging || !!isDiscarding}
            onClick={onOpenDiscardModal}
            className="border-danger/20 bg-danger/10 text-danger hover:bg-danger/20 flex h-7 cursor-pointer items-center rounded-md border px-2.5 text-xs font-medium transition-colors disabled:cursor-default disabled:opacity-20"
          >
            Discard Changes
          </button>
          <button
            type="button"
            disabled={files.length === 0 || !!isMerging || !!isDiscarding}
            onClick={onOpenMergeDialog}
            className="bg-accent text-brand-crust flex h-7 cursor-pointer items-center rounded-md px-3 text-xs font-medium transition-colors hover:opacity-90 disabled:cursor-default disabled:opacity-20"
          >
            Merge Session
          </button>
        </div>
      </div>
    </div>
  );
}
