import { forwardRef } from 'react';
import { Kbd, SearchBar } from '@agentctl/ui';

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
          placeholder="Search sessions"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
          }}
          onClear={onClear}
          className="control-default text-role-control motion-disclosure h-8 !pr-16 !pl-9"
        />
        {!value && (
          <div className="pointer-events-none absolute top-1/2 right-2 flex -translate-y-1/2 items-center transition-opacity group-focus-within/search:opacity-0">
            <Kbd>{isMac ? '⌘F' : 'Ctrl+F'}</Kbd>
          </div>
        )}
      </div>
    );
  },
);
