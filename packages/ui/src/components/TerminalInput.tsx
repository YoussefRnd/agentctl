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
        "bg-transparent border-border focus:border-white/40 focus:ring-1 focus:ring-white/10 h-8 rounded-sm border px-2 text-[12px] outline-none transition-all placeholder:text-text-muted/20 selection:bg-white selection:text-black disabled:opacity-30",
        className
      )}
      {...props}
    />
  );
});
