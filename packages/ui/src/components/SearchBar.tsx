import { type InputHTMLAttributes, type Ref } from 'react';
import { Search, X } from 'lucide-react';
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
      <Search className="text-text-muted/50 group-focus-within:text-accent pointer-events-none absolute top-1/2 left-3 z-10 h-3.5 w-3.5 -translate-y-1/2 transition-colors" />
      <input
        ref={ref}
        type="text"
        value={value}
        onChange={onChange}
        className={cn(
          'border-border/30 bg-surface-secondary/35 placeholder:text-text-muted/50 focus:bg-surface-secondary/60 focus:border-accent/50 text-text-main h-9 w-full rounded-lg border pr-10 pl-9 text-[12px] transition-all focus:outline-none',
          className,
        )}
        {...props}
      />
      {value && onClear && (
        <button
          type="button"
          onClick={onClear}
          className="hover:bg-surface-secondary/80 text-text-muted/60 hover:text-text-main absolute top-1/2 right-2 z-10 -translate-y-1/2 cursor-pointer rounded-sm p-1 transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

SearchBar.displayName = 'SearchBar';
