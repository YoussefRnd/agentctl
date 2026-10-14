import { type InputHTMLAttributes, type Ref } from 'react';
import { SearchIcon, XIcon } from '@primer/octicons-react';
import { cn } from '../utils.js';

export interface SearchBarProps extends InputHTMLAttributes<HTMLInputElement> {
  onClear?: () => void;
  containerClassName?: string;
  ref?: Ref<HTMLInputElement>;
}

export function SearchBar({
  className,
  containerClassName,
  value,
  onChange,
  onClear,
  ref,
  ...props
}: SearchBarProps) {
  return (
    <div className={cn('group relative flex w-full items-center', containerClassName)}>
      <SearchIcon className="text-text-muted/50 group-focus-within:text-accent pointer-events-none absolute top-1/2 left-3 z-10 h-3.5 w-3.5 -translate-y-1/2 transition-colors" />
      <input
        ref={ref}
        type="text"
        value={value}
        onChange={onChange}
        className={cn(
          'border-border/30 bg-surface-secondary/35 placeholder:text-text-muted/50 focus:bg-surface-secondary/60 focus:border-accent/50 focus:ring-accent/20 text-text-main h-9 w-full rounded-lg border pr-14 pl-9 text-[12px] transition-[background-color,border-color,box-shadow] duration-150 focus:ring-2 focus:outline-none',
          className,
        )}
        {...props}
      />
      {value && onClear && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={onClear}
          className="hover:bg-surface-secondary/80 text-text-muted/60 hover:text-text-main focus-visible:ring-accent/40 click-press absolute top-1/2 right-1.5 z-10 flex h-7 w-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md transition-[color,background-color,transform] duration-150 focus-visible:ring-2 focus-visible:outline-none"
        >
          <XIcon className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

SearchBar.displayName = 'SearchBar';
