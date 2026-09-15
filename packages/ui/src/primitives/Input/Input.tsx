import { type ComponentPropsWithoutRef, memo, type Ref } from 'react';
import { cn } from '../../utils.js';

export type InputSize = 'compact' | 'default' | 'large' | 'sm' | 'md' | 'lg';

export interface InputProps extends ComponentPropsWithoutRef<'input'> {
  ref?: Ref<HTMLInputElement>;
  sizeVariant?: InputSize;
  hasError?: boolean;
}

const sizes: Record<InputSize, string> = {
  sm: 'h-7 px-2 text-[11px]',
  compact: 'h-7 px-2 text-[11px]',
  md: 'h-8 px-2.5 text-[12px]',
  default: 'h-8 px-2.5 text-[12px]',
  lg: 'h-9 px-3 text-[13px]',
  large: 'h-9 px-3 text-[13px]',
};

export const Input = memo(function Input({
  className,
  sizeVariant = 'default',
  hasError = false,
  ref,
  ...props
}: InputProps) {
  const isError = hasError || props['aria-invalid'] === true || props['aria-invalid'] === 'true';

  return (
    <input
      ref={ref}
      className={cn(
        'border-border placeholder:text-text-muted/30 focus:border-accent/40 focus:ring-accent/10 rounded-md border bg-transparent font-mono transition-colors outline-none focus:ring-1 disabled:cursor-not-allowed disabled:opacity-30',
        sizes[sizeVariant],
        isError && 'border-danger focus:border-danger focus:ring-danger/20',
        className,
      )}
      {...props}
    />
  );
});
