import { memo } from 'react';
import type { HTMLAttributes } from 'react';
import { cn } from '../../utils.js';

export interface KbdProps extends HTMLAttributes<HTMLElement> {}

export const Kbd = memo(function Kbd({ className, children, ...props }: KbdProps) {
  return (
    <kbd
      className={cn(
        'border-border/40 bg-surface-secondary/60 text-text-muted inline-flex items-center justify-center rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold shadow-xs select-none',
        className,
      )}
      {...props}
    >
      {children}
    </kbd>
  );
});
