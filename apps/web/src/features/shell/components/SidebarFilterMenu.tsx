import { ListFilter } from 'lucide-react';
import { Switch, Tooltip } from '@agentctl/ui';

export type SortByOption = 'lastActive' | 'name' | 'createdAt';

interface SidebarFilterMenuProps {
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  sortBy: SortByOption;
  gitOnly: boolean;
  showArchived: boolean;
  onSettingsChange: (patch: {
    sortBy?: SortByOption;
    gitOnly?: boolean;
    showArchived?: boolean;
  }) => void;
}

export function SidebarFilterMenu({
  isOpen,
  onToggle,
  onClose,
  sortBy,
  gitOnly,
  showArchived,
  onSettingsChange,
}: SidebarFilterMenuProps) {
  return (
    <div className="relative flex items-center gap-1.5">
      <Tooltip content="Filter and Sort">
        <button
          type="button"
          onClick={onToggle}
          className={`hover:text-brand-mauve text-text-muted hover:bg-surface-secondary/40 cursor-pointer rounded-sm border border-transparent p-1 transition-all hover:scale-105 active:scale-95 ${
            isOpen ? 'text-brand-mauve bg-brand-mauve/10 border-brand-mauve/20' : ''
          }`}
        >
          <ListFilter className="h-3.5 w-3.5" />
        </button>
      </Tooltip>

      {isOpen && (
        <>
          <button
            type="button"
            aria-label="Close filter menu"
            className="fixed inset-0 z-30 cursor-default border-none bg-transparent outline-none"
            onClick={onClose}
          />
          <div className="border-border/80 bg-surface-secondary/95 animate-in fade-in slide-in-from-top-2 absolute top-full right-0 z-40 mt-1 w-52 rounded-xl border p-2.5 font-sans text-[11px] shadow-2xl backdrop-blur-md duration-200">
            <div className="text-text-muted mb-1.5 px-2 text-[10px] font-semibold tracking-wider uppercase opacity-50">
              Sort by
            </div>
            <div className="space-y-0.5">
              {(['lastActive', 'name', 'createdAt'] as const).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => {
                    onSettingsChange({ sortBy: opt });
                    onClose();
                  }}
                  className={`hover:bg-surface-tertiary flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left transition-colors ${
                    sortBy === opt
                      ? 'text-brand-mauve font-bold'
                      : 'text-text-muted hover:text-text-main font-medium'
                  }`}
                >
                  <span>
                    {opt === 'lastActive'
                      ? 'Last active'
                      : opt === 'name'
                        ? 'Name (A-Z)'
                        : 'Date created'}
                  </span>
                  {sortBy === opt && <span className="text-brand-mauve text-[10px]">●</span>}
                </button>
              ))}
            </div>

            <div className="border-border/30 my-2 border-t" />

            <div className="text-text-muted mb-1.5 px-2 text-[10px] font-semibold tracking-wider uppercase opacity-50">
              Filter
            </div>
            <div className="space-y-1">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSettingsChange({ gitOnly: !gitOnly });
                }}
                className={`hover:bg-surface-tertiary flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left transition-colors ${
                  gitOnly
                    ? 'text-brand-mauve font-bold'
                    : 'text-text-muted hover:text-text-main font-medium'
                }`}
              >
                <span>Git repos only</span>
                <Switch
                  checked={gitOnly}
                  size="sm"
                  aria-label="Git repos only"
                  className="pointer-events-none"
                />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSettingsChange({ showArchived: !showArchived });
                }}
                className={`hover:bg-surface-tertiary flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left transition-colors ${
                  showArchived
                    ? 'text-brand-mauve font-bold'
                    : 'text-text-muted hover:text-text-main font-medium'
                }`}
              >
                <span>Show archived sessions</span>
                <Switch
                  checked={showArchived}
                  size="sm"
                  aria-label="Show archived sessions"
                  className="pointer-events-none"
                />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
