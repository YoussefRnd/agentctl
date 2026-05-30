import { type ComponentPropsWithoutRef, memo } from 'react';
import { cn } from '../utils';

/**
 * Standardized input for the OLED Terminal aesthetic.
 */
export const TerminalInput = memo(function TerminalInput({
  className,
  ...props
}: ComponentPropsWithoutRef<'input'>) {
  return (
    <input
      className={cn(
        'border-border focus:border-accent/40 focus:ring-accent/10 placeholder:text-text-muted/20 selection:bg-accent selection:text-background h-8 rounded-md border bg-transparent px-2 text-[12px] transition-all outline-none focus:ring-1 disabled:opacity-30',
        className,
      )}
      {...props}
    />
  );
});
