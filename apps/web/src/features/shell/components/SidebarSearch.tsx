import { forwardRef } from 'react';
import { SearchBar } from '@agentctl/ui';

interface SidebarSearchProps {
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
  isMac?: boolean;
}

export const SidebarSearch = forwardRef<HTMLInputElement, SidebarSearchProps>(
  function SidebarSearch({ value, onChange, onClear, isMac }, ref) {
    return (
      <div className="group/search relative">
        <SearchBar
          ref={ref}
          placeholder="Search sessions..."
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
          }}
          onClear={onClear}
          className="bg-surface/50 border-border/40 hover:border-border/70 focus-within:border-accent/50 focus-within:bg-surface/80 h-8 rounded-lg text-xs transition-all"
        />
        {!value && (
          <div className="pointer-events-none absolute top-1/2 right-2.5 flex -translate-y-1/2 items-center opacity-40 transition-opacity group-focus-within/search:opacity-0 group-hover/search:opacity-70">
            <kbd className="bg-surface-secondary/90 border-border/40 text-text-muted rounded px-1 py-0.5 font-mono text-[9px] font-medium tracking-tight">
              {isMac ? '⌘K' : 'Ctrl+K'}
            </kbd>
          </div>
        )}
      </div>
    );
  },
);
