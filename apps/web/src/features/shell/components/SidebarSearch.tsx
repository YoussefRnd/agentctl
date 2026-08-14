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
      <div className="relative">
        <SearchBar
          ref={ref}
          placeholder="Search..."
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
          }}
          onClear={onClear}
        />
        {!value && (
          <div className="pointer-events-none absolute top-1/2 right-3 flex -translate-y-1/2 items-center opacity-60 transition-opacity">
            <kbd className="bg-surface-secondary/80 border-border/50 text-text-muted rounded border px-1.5 py-0.5 font-mono text-[10px] font-bold">
              {isMac ? '⌘K' : 'Ctrl+K'}
            </kbd>
          </div>
        )}
      </div>
    );
  },
);
