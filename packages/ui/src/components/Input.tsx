import { type ComponentPropsWithoutRef, memo } from 'react';
import { cn } from '../utils';

export const Input = memo(function Input({
  className,
  ...props
}: ComponentPropsWithoutRef<'input'>) {
  return (
    <input
      className={cn(
        'border-border bg-surface-secondary/50 placeholder:text-text-muted/30 focus:border-accent/40 focus:ring-accent/10 h-10 rounded-xl border px-3 font-sans text-[14px] transition-all outline-none focus:ring-4 disabled:opacity-30',
        className,
      )}
      {...props}
    />
  );
});
