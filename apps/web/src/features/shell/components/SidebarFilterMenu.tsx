import { ListFilter, Check } from 'lucide-react';
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
    <div className="relative flex items-center">
      <Tooltip content="Filter & Sort">
        <button
          type="button"
          onClick={onToggle}
          className={`hover:text-text-main text-text-muted hover:bg-surface-secondary/70 flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border transition-all ${
            isOpen ? 'text-accent bg-accent/10 border-accent/30' : 'border-transparent'
          }`}
          aria-label="Filter & Sort"
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
          <div className="border-border/70 bg-surface/95 animate-in fade-in slide-in-from-top-1.5 absolute top-full right-0 z-40 mt-1.5 w-52 rounded-xl border p-2 font-sans text-xs shadow-2xl backdrop-blur-xl duration-150">
            <div className="text-text-muted/60 mb-1 px-2 text-[10px] font-semibold tracking-wider uppercase">
              Sort by
            </div>
            <div className="space-y-0.5">
              {(
                [
                  { id: 'lastActive', label: 'Last active' },
                  { id: 'name', label: 'Project name' },
                  { id: 'createdAt', label: 'Date created' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    onSettingsChange({ sortBy: opt.id });
                    onClose();
                  }}
                  className={`hover:bg-surface-secondary/80 flex w-full cursor-pointer items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs transition-colors ${
                    sortBy === opt.id
                      ? 'text-accent font-semibold'
                      : 'text-text-muted hover:text-text-main font-normal'
                  }`}
                >
                  <span>{opt.label}</span>
                  {sortBy === opt.id && <Check className="text-accent h-3.5 w-3.5" />}
                </button>
              ))}
            </div>

            <div className="border-border/30 my-1.5 border-t" />

            <div className="text-text-muted/60 mb-1 px-2 text-[10px] font-semibold tracking-wider uppercase">
              Filter
            </div>
            <div className="space-y-0.5">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSettingsChange({ gitOnly: !gitOnly });
                }}
                className="hover:bg-surface-secondary/80 text-text-muted hover:text-text-main flex w-full cursor-pointer items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs transition-colors"
              >
                <span>Git repositories only</span>
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
                className="hover:bg-surface-secondary/80 text-text-muted hover:text-text-main flex w-full cursor-pointer items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs transition-colors"
              >
                <span>Show archived</span>
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
