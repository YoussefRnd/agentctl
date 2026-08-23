import { type ComponentPropsWithoutRef, memo, type Ref } from 'react';
import { cn } from '../utils';

export const Input = memo(function Input({
  className,
  ref,
  ...props
}: ComponentPropsWithoutRef<'input'> & { ref?: Ref<HTMLInputElement> }) {
  return (
    <input
      ref={ref}
      className={cn(
        'border-border placeholder:text-text-muted/30 focus:border-accent/40 focus:ring-accent/10 h-8 rounded-md border bg-transparent px-2.5 font-mono text-[12px] transition-colors outline-none focus:ring-1 disabled:opacity-30',
        className,
      )}
      {...props}
    />
  );
});
