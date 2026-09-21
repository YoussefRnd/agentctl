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
          aria-label="Search sessions"
          placeholder="Search sessions..."
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
          }}
          onClear={onClear}
          className="bg-surface-secondary/25 border-border/25 hover:border-border/40 hover:bg-surface-secondary/40 focus-within:border-accent/40 focus-within:bg-surface-secondary/50 placeholder:text-text-muted/40 h-8 rounded-lg text-xs transition-[background-color,border-color] duration-150"
        />
        {!value && (
          <div className="pointer-events-none absolute top-1/2 right-2.5 flex -translate-y-1/2 items-center opacity-40 transition-opacity group-focus-within/search:opacity-0 group-hover/search:opacity-70">
            <kbd className="bg-surface-secondary/80 border-border/30 text-text-muted/70 rounded px-1.5 py-0.5 font-mono text-[9.5px] font-medium tracking-tight">
              {isMac ? '⌘F' : 'Ctrl+F'}
            </kbd>
          </div>
        )}
      </div>
    );
  },
);
