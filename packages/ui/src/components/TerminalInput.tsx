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
        "bg-transparent border-border focus:border-accent/40 focus:ring-1 focus:ring-accent/10 h-8 rounded-md border px-2 text-[12px] outline-none transition-all placeholder:text-text-muted/20 selection:bg-accent selection:text-background disabled:opacity-30",
        className
      )}
      {...props}
    />
  );
});
